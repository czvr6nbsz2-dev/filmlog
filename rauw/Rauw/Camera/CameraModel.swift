import AVFoundation
import CoreImage
import ImageIO
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
    @Published var lens: RearLens = .wide {
        didSet {
            guard lens != oldValue else { return }
            persist()
            reconfigure()
        }
    }
    @Published var isFront = false {
        didSet {
            guard isFront != oldValue else { return }
            reconfigure()
        }
    }
    @Published var control: ExposureControl = .auto { didSet { persist(); applyExposure() } }
    @Published var evThirds: Int = 0 { didSet { persist(); applyExposure() } }
    @Published var aeLocked = false { didSet { applyExposure() } }
    @Published var manualShutter: Double = 1.0 / 125.0 { didSet { persist(); applyExposure() } }
    @Published var manualISO: Float = 400 { didSet { persist(); applyExposure() } }

    // MARK: - Read-only staat voor de UI
    @Published var displayShutter = "—"
    @Published var displayISO = "—"
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
    /// Loopt op bij elke herconfiguratie-aanvraag; een al-ingeplande maar
    /// nog niet uitgevoerde herconfiguratie slaat zichzelf over als er
    /// inmiddels een nieuwere is. Voorkomt opstapelen bij snel lenswisselen.
    private var reconfigureGeneration = 0
    /// Stand van het toestel op het moment van afdrukken; wordt als
    /// oriëntatietag in de DNG geschreven (Bayer RAW kan niet fysiek roteren).
    private var pendingOrientation: CGImagePropertyOrientation = .right

    /// De look die in de begeleidende JPG gebakken moet worden. De DNG blijft
    /// altijd neutraal; dit raakt alleen de JPG.
    struct BakedLook {
        let filter: CIFilter?
        let vignette: Bool
        static let none = BakedLook(filter: nil, vignette: false)
    }
    /// Levert op het moment van afdrukken een verse look-snapshot. Wordt door
    /// de view-laag ingesteld (zie ContentView) en op de main-thread aangeroepen.
    var lookSnapshot: () -> BakedLook = { .none }
    private var pendingLook = BakedLook.none
    private lazy var jpegContext = CIContext(options: [
        .workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!
    ])

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
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        // Sessiefouten tonen in plaats van stil falen
        NotificationCenter.default.addObserver(
            forName: .AVCaptureSessionRuntimeError, object: session, queue: .main
        ) { [weak self] note in
            let error = note.userInfo?[AVCaptureSessionErrorKey] as? AVError
            self?.statusMessage = "Camerafout: \(error?.localizedDescription ?? "onbekend")"
        }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            guard granted else {
                DispatchQueue.main.async {
                    self.statusMessage = "Geen cameratoegang — zet aan in Instellingen > Rauw."
                }
                return
            }
            let front = self.isFront
            let lens = self.lens
            self.sessionQueue.async {
                self.configureSession(isFront: front, lens: lens)
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
        // Lees de doelstand op de main-thread (waar didSet draait) en geef
        // hem mee, zodat de sessie-queue geen @Published-staat hoeft te lezen.
        reconfigureGeneration += 1
        let gen = reconfigureGeneration
        let front = isFront
        let lens = lens
        sessionQueue.async {
            // Sla over als er inmiddels een nieuwere aanvraag is binnengekomen.
            guard gen == self.reconfigureGeneration else { return }
            self.configureSession(isFront: front, lens: lens)
        }
    }

    private func configureSession(isFront: Bool, lens: RearLens) {
        let position: AVCaptureDevice.Position = isFront ? .front : .back
        let type: AVCaptureDevice.DeviceType = isFront ? .builtInWideAngleCamera : lens.deviceType
        guard let dev = AVCaptureDevice.default(type, for: .video, position: position) else {
            DispatchQueue.main.async { self.statusMessage = "Camera niet beschikbaar" }
            return
        }
        // Niets doen als deze camera al actief is (voorkomt dubbele herconfiguratie)
        if dev.uniqueID == device?.uniqueID, input != nil { return }
        guard let newInput = try? AVCaptureDeviceInput(device: dev) else {
            DispatchQueue.main.async { self.statusMessage = "Camera niet beschikbaar" }
            return
        }

        session.beginConfiguration()
        if session.sessionPreset != .photo { session.sessionPreset = .photo }

        if let input {
            session.removeInput(input)
            self.input = nil
        }
        guard session.canAddInput(newInput) else {
            session.commitConfiguration()
            DispatchQueue.main.async { self.statusMessage = "Camera niet beschikbaar" }
            return
        }
        session.addInput(newInput)
        input = newInput
        device = dev

        if !session.outputs.contains(photoOutput), session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
            photoOutput.maxPhotoQualityPrioritization = .quality
        }
        if !session.outputs.contains(videoOutput), session.canAddOutput(videoOutput) {
            session.addOutput(videoOutput)
        }
        session.commitConfiguration()

        // Pas ná commit staat het definitieve camera-format vast; resolutie en
        // verbindingen daarna instellen voorkomt mismatches (crashbron).
        let dims = dev.activeFormat.supportedMaxPhotoDimensions
        if let largest = dims.max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) {
            photoOutput.maxPhotoDimensions = largest
        }

        for connection in [photoOutput.connection(with: .video), videoOutput.connection(with: .video)] {
            guard let c = connection else { continue }
            if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        }
        if let c = videoOutput.connection(with: .video) {
            c.automaticallyAdjustsVideoMirroring = false
            c.isVideoMirrored = isFront
        }

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
        // Een tik in de zoeker ontgrendelt een actieve AE-lock
        if aeLocked { aeLocked = false }
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
        pendingOrientation = currentExifOrientation()
        pendingLook = lookSnapshot()
        DispatchQueue.main.async { self.isCapturing = true }
        sessionQueue.async {
            // Alleen maten die zowel het actuele format als de output toestaan
            let outputMax = Int(self.photoOutput.maxPhotoDimensions.width)
                * Int(self.photoOutput.maxPhotoDimensions.height)
            let dims = (self.device?.activeFormat.supportedMaxPhotoDimensions ?? [])
                .filter { Int($0.width) * Int($0.height) <= max(outputMax, 1) }
                .sorted { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }
            // Verwerkte bron voor de begeleidende JPG (JPEG indien beschikbaar,
            // anders HEVC); we hercoderen zelf toch naar JPG met de look erin.
            let codecs = self.photoOutput.availablePhotoCodecTypes
            let processedCodec: AVVideoCodecType? =
                codecs.contains(.jpeg) ? .jpeg : (codecs.contains(.hevc) ? .hevc : nil)
            let settings: AVCapturePhotoSettings
            if let raw = self.photoOutput.availableRawPhotoPixelFormatTypes
                .first(where: { AVCapturePhotoOutput.isBayerRAWPixelFormat($0) }) {
                // RAW voor Lightroom + verwerkte foto als bron voor de JPG.
                if let codec = processedCodec {
                    settings = AVCapturePhotoSettings(
                        rawPixelFormatType: raw,
                        processedFormat: [AVVideoCodecKey: codec])
                } else {
                    settings = AVCapturePhotoSettings(rawPixelFormatType: raw)
                }
                // photoQualityPrioritization mag NIET bij een RAW-opname
                // (crasht: "Unsupported when capturing RAW"). Bewust weggelaten.
                // Bayer RAW levert 12 MP; vraag geen grotere processed maat
                if let d = dims.first(where: { Int($0.width) * Int($0.height) >= 12_000_000 }) ?? dims.last {
                    settings.maxPhotoDimensions = d
                }
            } else if let codec = processedCodec {
                // Frontcamera kan geen RAW; alleen de verwerkte foto -> JPG.
                settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: codec])
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
            guard let self else { return }
            // `device` wordt op de sessie-queue ge(her)configureerd; daar ook
            // lezen voorkomt een data-race met het wisselen van lens/camera.
            self.sessionQueue.async {
                guard let dev = self.device else { return }
                let seconds = dev.exposureDuration.seconds
                let iso = dev.iso
                // Tijdens een (her)configuratie is exposureDuration even ongeldig
                // en geeft CMTime.seconds NaN; Int(NaN) crasht fataal. Afvangen.
                guard seconds.isFinite, seconds > 0, iso.isFinite else { return }
                let shutter = seconds >= 0.4
                    ? String(format: "%.1f\"", seconds)
                    : "1/\(Int((1.0 / seconds).rounded()))"
                DispatchQueue.main.async {
                    self.displayShutter = shutter
                    self.displayISO = "\(Int(iso.rounded()))"
                }
            }
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

    /// Stand van het toestel -> EXIF-oriëntatie voor de achtercamera
    /// (sensor staat landschap; portret = 90° gedraaid = .right).
    private func currentExifOrientation() -> CGImagePropertyOrientation {
        switch UIDevice.current.orientation {
        case .landscapeLeft: return isFront ? .down : .up
        case .landscapeRight: return isFront ? .up : .down
        case .portraitUpsideDown: return .left
        default: return .right
        }
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
        if photo.isRawPhoto {
            // RAW -> DNG met oriëntatietag (Bayer kan niet fysiek roteren).
            // Ongewijzigd t.o.v. eerder: jouw Lightroom-workflow blijft gelijk.
            guard let data = photo.fileDataRepresentation(
                with: OrientationCustomizer(orientation: pendingOrientation)) else {
                DispatchQueue.main.async { self.statusMessage = "Geen RAW-data ontvangen" }
                return
            }
            save(data: data, isRaw: true)
        } else {
            // Verwerkte foto -> JPG met de actieve look erin gebakken,
            // als apart bestand naast de DNG zodat je 'm kunt delen.
            guard let cg = photo.cgImageRepresentation() else {
                DispatchQueue.main.async { self.statusMessage = "Geen fotodata ontvangen" }
                return
            }
            // De verwerkte foto komt door de connection-rotatie al rechtop
            // binnen (metadata .up). Ontbreekt de tag, dan niet alsnog draaien.
            let orientation = (photo.metadata[kCGImagePropertyOrientation as String] as? UInt32)
                .flatMap { CGImagePropertyOrientation(rawValue: $0) } ?? .up
            guard let jpg = renderLookedJPEG(from: cg, orientation: orientation) else {
                DispatchQueue.main.async { self.statusMessage = "JPG maken mislukt" }
                return
            }
            save(data: jpg, isRaw: false)
        }
    }

    /// Bakt de actieve look (LUT + vignet) in de verwerkte
    /// foto en codeert die als JPEG. De oriëntatie wordt in de pixels gebakken,
    /// zodat de JPG zonder oriëntatietag al goed staat.
    private func renderLookedJPEG(from cg: CGImage, orientation: CGImagePropertyOrientation) -> Data? {
        var image = CIImage(cgImage: cg)
        let look = pendingLook
        if let filter = look.filter {
            filter.setValue(image, forKey: kCIInputImageKey)
            if let out = filter.outputImage { image = out }
            if look.vignette {
                image = image.applyingFilter("CIVignette", parameters: [
                    kCIInputIntensityKey: 0.5, kCIInputRadiusKey: 1.8,
                ])
            }
        }
        image = image.oriented(orientation)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        return jpegContext.jpegRepresentation(of: image, colorSpace: space)
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
                } else {
                    options.uniformTypeIdentifier = "public.jpeg"
                    options.originalFilename = "RAUW_\(Self.filenameStamp()).jpg"
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

/// Schrijft de juiste oriëntatie in de DNG-metadata.
private final class OrientationCustomizer: NSObject, AVCapturePhotoFileDataRepresentationCustomizer {
    let orientation: CGImagePropertyOrientation

    init(orientation: CGImagePropertyOrientation) {
        self.orientation = orientation
    }

    func replacementMetadata(for photo: AVCapturePhoto) -> [String: Any]? {
        var metadata = photo.metadata
        metadata[kCGImagePropertyOrientation as String] = NSNumber(value: orientation.rawValue)
        return metadata
    }
}
