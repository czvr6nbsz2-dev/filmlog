import AVFoundation
import Photos
import UIKit

enum RearLens: Int, CaseIterable {
    case ultraWide = 0
    case wide = 1

    var label: String { self == .ultraWide ? "13" : "26" }
    var deviceType: AVCaptureDevice.DeviceType {
        self == .ultraWide ? .builtInUltraWideCamera : .builtInWideAngleCamera
    }
}

enum ExposureControl: String {
    /// "A-priority" op iPhone: diafragma ligt vast per lens, camera kiest
    /// sluitertijd + ISO, jij stuurt met EV-compensatie en AE-lock.
    case auto = "A"
    case manual = "M"
}

final class CameraModel: NSObject, ObservableObject {

    // MARK: - Instelbare staat (blijft bewaard tussen sessies)
    @Published var lens: RearLens = .wide { didSet { persist(); reconfigure() } }
    @Published var isFront = false { didSet { reconfigure() } }
    @Published var control: ExposureControl = .auto { didSet { persist(); applyExposure() } }
    @Published var evThirds: Int = 0 { didSet { persist(); applyExposure() } }
    @Published var aeLocked = false { didSet { applyExposure() } }
    @Published var manualShutter: Double = 1.0 / 125.0 { didSet { persist(); applyExposure() } }
    @Published var manualISO: Float = 400 { didSet { persist(); applyExposure() } }

    // MARK: - Read-only staat voor de UI
    @Published var displayShutter = "—"
    @Published var displayISO = "—"
    @Published var lastThumbnail: UIImage?
    @Published var rawAvailable = false
    @Published var statusMessage: String?
    @Published var focusIndicator: CGPoint?   // genormaliseerd (0–1) in previewcoördinaten
    @Published var isCapturing = false

    let session = AVCaptureSession()
    let videoOutput = AVCaptureVideoDataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "rauw.session")
    private var input: AVCaptureDeviceInput?
    private(set) var device: AVCaptureDevice?
    private var readTimer: Timer?
    private var started = false

    static let shutterSpeeds: [Double] = [
        1/4000, 1/2000, 1/1000, 1/500, 1/250, 1/125, 1/60, 1/30, 1/15, 1/8, 1/4, 1/2, 1,
    ]
    static let isoValues: [Float] = [50, 100, 200, 400, 800, 1600, 3200]

    override init() {
        super.init()
        restore()
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
    }

    // MARK: - Levenscyclus

    func start() {
        started = true
        UIApplication.shared.isIdleTimerDisabled = true
        AVCaptureDevice.requestAccess(for: .video) { granted in
            guard granted else {
                DispatchQueue.main.async {
                    self.statusMessage = "Geen cameratoegang — zet aan in Instellingen > Rauw."
                }
                return
            }
            self.sessionQueue.async {
                self.configureSession()
                self.session.startRunning()
            }
        }
        startReadout()
    }

    func stop() {
        sessionQueue.async { self.session.stopRunning() }
        readTimer?.invalidate()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func reconfigure() {
        guard started else { return }
        sessionQueue.async { self.configureSession() }
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .photo

        if let input {
            session.removeInput(input)
            self.input = nil
        }

        let position: AVCaptureDevice.Position = isFront ? .front : .back
        let type: AVCaptureDevice.DeviceType = isFront ? .builtInWideAngleCamera : lens.deviceType
        guard let dev = AVCaptureDevice.default(type, for: .video, position: position),
              let newInput = try? AVCaptureDeviceInput(device: dev),
              session.canAddInput(newInput)
        else {
            session.commitConfiguration()
            DispatchQueue.main.async { self.statusMessage = "Camera niet beschikbaar" }
            return
        }
        session.addInput(newInput)
        input = newInput
        device = dev

        if !session.outputs.contains(photoOutput), session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
        }
        if !session.outputs.contains(videoOutput), session.canAddOutput(videoOutput) {
            session.addOutput(videoOutput)
        }
        photoOutput.maxPhotoQualityPrioritization = .quality

        // Output-cap op het maximum; per opname wordt de juiste maat gekozen.
        // (Bayer RAW is door Apple sowieso begrensd op 12 MP buiten ProRAW.)
        let sorted = dev.activeFormat.supportedMaxPhotoDimensions
            .sorted { $0.width * $0.height < $1.width * $1.height }
        if let largest = sorted.last { photoOutput.maxPhotoDimensions = largest }

        for connection in [photoOutput.connection(with: .video), videoOutput.connection(with: .video)] {
            guard let c = connection else { continue }
            if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        }
        if let c = videoOutput.connection(with: .video) {
            c.automaticallyAdjustsVideoMirroring = false
            c.isVideoMirrored = isFront
        }

        session.commitConfiguration()

        let raw = photoOutput.availableRawPhotoPixelFormatTypes
            .contains { AVCapturePhotoOutput.isBayerRAWPixelFormat($0) }
        DispatchQueue.main.async { self.rawAvailable = raw }

        applyExposureOnQueue()
    }

    // MARK: - Belichting

    private func applyExposure() {
        guard started else { return }
        sessionQueue.async { self.applyExposureOnQueue() }
    }

    private func applyExposureOnQueue() {
        guard let dev = device else { return }
        do {
            try dev.lockForConfiguration()
            defer { dev.unlockForConfiguration() }
            switch control {
            case .auto:
                let bias = min(max(Float(evThirds) / 3.0, dev.minExposureTargetBias), dev.maxExposureTargetBias)
                dev.setExposureTargetBias(bias)
                if aeLocked, dev.isExposureModeSupported(.locked) {
                    dev.exposureMode = .locked
                } else if dev.isExposureModeSupported(.continuousAutoExposure) {
                    dev.exposureMode = .continuousAutoExposure
                }
            case .manual:
                guard dev.isExposureModeSupported(.custom) else { return }
                let format = dev.activeFormat
                let seconds = min(max(manualShutter, format.minExposureDuration.seconds),
                                  format.maxExposureDuration.seconds)
                let iso = min(max(manualISO, format.minISO), format.maxISO)
                dev.setExposureModeCustom(
                    duration: CMTime(seconds: seconds, preferredTimescale: 1_000_000),
                    iso: iso
                )
            }
        } catch {
            DispatchQueue.main.async { self.statusMessage = "Belichting instellen mislukt" }
        }
    }

    // MARK: - Scherpstellen (AF-S)

    /// Eén keer scherpstellen op het tikpunt, daarna blijft de focus staan.
    /// `point` is genormaliseerd (0–1) in portret-previewcoördinaten.
    func focusSingle(atNormalized point: CGPoint) {
        DispatchQueue.main.async { self.focusIndicator = point }
        sessionQueue.async {
            guard let dev = self.device else { return }
            // portret (rotatie 90°) -> sensorcoördinaten (landschap)
            let devicePoint = CGPoint(x: point.y, y: 1.0 - point.x)
            do {
                try dev.lockForConfiguration()
                defer { dev.unlockForConfiguration() }
                if dev.isFocusPointOfInterestSupported, dev.isFocusModeSupported(.autoFocus) {
                    dev.focusPointOfInterest = devicePoint
                    dev.focusMode = .autoFocus
                }
                if dev.isExposurePointOfInterestSupported, self.control == .auto, !self.aeLocked {
                    dev.exposurePointOfInterest = devicePoint
                    if dev.isExposureModeSupported(.continuousAutoExposure) {
                        dev.exposureMode = .continuousAutoExposure
                    }
                }
                dev.isSubjectAreaChangeMonitoringEnabled = false
            } catch {}
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            if self.focusIndicator == point { self.focusIndicator = nil }
        }
    }

    // MARK: - Opname

    func capture() {
        DispatchQueue.main.async { self.isCapturing = true }
        sessionQueue.async {
            let dims = (self.device?.activeFormat.supportedMaxPhotoDimensions ?? [])
                .sorted { $0.width * $0.height < $1.width * $1.height }
            let settings: AVCapturePhotoSettings
            if let raw = self.photoOutput.availableRawPhotoPixelFormatTypes
                .first(where: { AVCapturePhotoOutput.isBayerRAWPixelFormat($0) }) {
                settings = AVCapturePhotoSettings(rawPixelFormatType: raw)
                // Bayer RAW kan per definitie niet computationeel verwerkt worden
                settings.photoQualityPrioritization = .speed
                // Bayer RAW levert 12 MP; vraag geen grotere processed maat
                if let d = dims.first(where: { $0.width * $0.height >= 12_000_000 }) ?? dims.last {
                    settings.maxPhotoDimensions = d
                }
            } else if self.photoOutput.availablePhotoCodecTypes.contains(.hevc) {
                // Frontcamera kan geen RAW; daar valt de app terug op HEIF.
                settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
                settings.photoQualityPrioritization = .quality
                if let d = dims.last { settings.maxPhotoDimensions = d }
            } else {
                settings = AVCapturePhotoSettings()
            }
            settings.flashMode = .off
            if let previewFormat = settings.availablePreviewPhotoPixelFormatTypes.first {
                settings.previewPhotoFormat = [
                    kCVPixelBufferPixelFormatTypeKey as String: previewFormat,
                    kCVPixelBufferWidthKey as String: 512,
                    kCVPixelBufferHeightKey as String: 512,
                ]
            }
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    // MARK: - Uitlezing voor de UI

    private func startReadout() {
        readTimer?.invalidate()
        readTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self, let dev = self.device else { return }
            let seconds = dev.exposureDuration.seconds
            self.displayShutter = seconds >= 0.4
                ? String(format: "%.1f\"", seconds)
                : "1/\(Int((1.0 / max(seconds, 1e-6)).rounded()))"
            self.displayISO = "\(Int(dev.iso.rounded()))"
        }
    }

    // MARK: - Persistentie

    private func persist() {
        let d = UserDefaults.standard
        d.set(lens.rawValue, forKey: "lens")
        d.set(control.rawValue, forKey: "control")
        d.set(evThirds, forKey: "evThirds")
        d.set(manualShutter, forKey: "manualShutter")
        d.set(Double(manualISO), forKey: "manualISO")
    }

    private func restore() {
        // Eerst alles lezen, dan pas toewijzen: didSet roept persist() aan,
        // wat anders nog-niet-geladen waardes zou overschrijven.
        let d = UserDefaults.standard
        let savedLens = d.object(forKey: "lens") != nil ? RearLens(rawValue: d.integer(forKey: "lens")) : nil
        let savedControl = ExposureControl(rawValue: d.string(forKey: "control") ?? "")
        let savedEV = d.object(forKey: "evThirds") != nil ? d.integer(forKey: "evThirds") : nil
        let savedShutter = d.object(forKey: "manualShutter") != nil ? d.double(forKey: "manualShutter") : nil
        let savedISO = d.object(forKey: "manualISO") != nil ? Float(d.double(forKey: "manualISO")) : nil
        if let savedLens { lens = savedLens }
        if let savedControl { control = savedControl }
        if let savedEV { evThirds = savedEV }
        if let savedShutter { manualShutter = savedShutter }
        if let savedISO { manualISO = savedISO }
    }

    static func shutterLabel(_ seconds: Double) -> String {
        seconds >= 1 ? String(format: "%.0f\"", seconds) : "1/\(Int((1.0 / seconds).rounded()))"
    }
}

// MARK: - Opslaan in de fotobibliotheek

extension CameraModel: AVCapturePhotoCaptureDelegate {

    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        DispatchQueue.main.async { self.isCapturing = false }
        if let error {
            DispatchQueue.main.async { self.statusMessage = "Opname mislukt: \(error.localizedDescription)" }
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            DispatchQueue.main.async { self.statusMessage = "Geen fotodata ontvangen" }
            return
        }
        if let cg = photo.previewCGImageRepresentation() {
            let thumb = UIImage(cgImage: cg)
            DispatchQueue.main.async { self.lastThumbnail = thumb }
        }
        save(data: data, isRaw: photo.isRawPhoto)
    }

    private func save(data: Data, isRaw: Bool) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async { self.statusMessage = "Geen toegang tot fotobibliotheek" }
                return
            }
            PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                if isRaw {
                    options.uniformTypeIdentifier = "com.adobe.raw-image"
                    options.originalFilename = "RAUW_\(Self.filenameStamp()).dng"
                }
                request.addResource(with: .photo, data: data, options: options)
            } completionHandler: { ok, error in
                if !ok {
                    DispatchQueue.main.async {
                        self.statusMessage = "Opslaan mislukt: \(error?.localizedDescription ?? "onbekend")"
                    }
                }
            }
        }
    }

    private static func filenameStamp() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd_HHmmss"
        return f.string(from: Date())
    }
}
