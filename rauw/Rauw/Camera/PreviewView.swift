import AVFoundation
import AVKit
import CoreImage
import MetalKit
import SwiftUI

/// Metal-zoeker: ontvangt cameraframes, past optioneel de LUT
/// (+ subtiel vignet, zoals in het LR-profiel) toe en tekent ze.
/// Levert daarnaast zebra's (overbelichtingswaarschuwing) en
/// histogramdata — beide gemeten op het beeld vóór de LUT, zodat ze
/// de opname beschrijven en niet de preview-look.
final class PreviewRenderer: MTKView, MTKViewDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {

    private var commandQueue: MTLCommandQueue!
    private var ciContext: CIContext!
    private let renderColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private let imageLock = NSLock()
    private var latestImage: CIImage?
    private var frameIndex = 0

    var look: CIFilter?
    var vignette = false
    var zebrasEnabled = false
    var histogramEnabled = false
    var onHistogram: (([Float]) -> Void)?

    private lazy var stripePattern: CIImage = {
        let gen = CIFilter(name: "CIStripesGenerator")!
        gen.setValue(CIColor(red: 1, green: 1, blue: 1), forKey: "inputColor0")
        gen.setValue(CIColor(red: 0, green: 0, blue: 0), forKey: "inputColor1")
        gen.setValue(6, forKey: "inputWidth")
        return (gen.outputImage ?? CIImage.empty())
            .transformed(by: CGAffineTransform(rotationAngle: .pi / 4))
    }()

    init() {
        let metalDevice = MTLCreateSystemDefaultDevice()
        super.init(frame: .zero, device: metalDevice)
        guard let metalDevice else { return }
        framebufferOnly = false
        isOpaque = true
        backgroundColor = .black
        commandQueue = metalDevice.makeCommandQueue()
        ciContext = CIContext(mtlDevice: metalDevice, options: [.cacheIntermediates: false])
        delegate = self
        preferredFramesPerSecond = 30
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("niet ondersteund") }

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        imageLock.lock()
        latestImage = image
        imageLock.unlock()

        frameIndex += 1
        if histogramEnabled, frameIndex % 6 == 0 {
            computeHistogram(from: image)
        }
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        imageLock.lock()
        let snapshot = latestImage
        imageLock.unlock()
        guard let source = snapshot,
              let drawable = currentDrawable,
              let buffer = commandQueue?.makeCommandBuffer()
        else { return }

        let size = drawableSize
        guard size.width > 0, size.height > 0, source.extent.width > 0 else { return }
        let bounds = CGRect(origin: .zero, size: size)
        let scale = max(size.width / source.extent.width, size.height / source.extent.height)
        let base = source
            .transformed(by: .init(translationX: -source.extent.origin.x, y: -source.extent.origin.y))
            .transformed(by: .init(scaleX: scale, y: scale))
            .cropped(to: bounds)

        var image = base
        if let look {
            look.setValue(base, forKey: kCIInputImageKey)
            if let output = look.outputImage { image = output }
            if vignette, let v = CIFilter(name: "CIVignette") {
                v.setValue(image, forKey: kCIInputImageKey)
                v.setValue(0.5, forKey: kCIInputIntensityKey)
                v.setValue(1.8, forKey: kCIInputRadiusKey)
                if let output = v.outputImage { image = output.cropped(to: bounds) }
            }
        }
        if zebrasEnabled {
            image = applyZebras(to: image, measuring: base, bounds: bounds)
        }

        ciContext.render(image,
                         to: drawable.texture,
                         commandBuffer: buffer,
                         bounds: bounds,
                         colorSpace: renderColorSpace)
        buffer.present(drawable)
        buffer.commit()
    }

    /// Diagonale zwart-witstrepen op delen die (bijna) uitgebeten zijn.
    private func applyZebras(to image: CIImage, measuring base: CIImage, bounds: CGRect) -> CIImage {
        guard let luma = CIFilter(name: "CIColorMatrix"),
              let threshold = CIFilter(name: "CIColorThreshold"),
              let blend = CIFilter(name: "CIBlendWithMask")
        else { return image }

        let lumaVector = CIVector(x: 0.2126, y: 0.7152, z: 0.0722, w: 0)
        luma.setValue(base, forKey: kCIInputImageKey)
        luma.setValue(lumaVector, forKey: "inputRVector")
        luma.setValue(lumaVector, forKey: "inputGVector")
        luma.setValue(lumaVector, forKey: "inputBVector")

        threshold.setValue(luma.outputImage, forKey: kCIInputImageKey)
        threshold.setValue(0.97, forKey: "inputThreshold")

        blend.setValue(stripePattern.cropped(to: bounds), forKey: kCIInputImageKey)
        blend.setValue(image, forKey: kCIInputBackgroundImageKey)
        blend.setValue(threshold.outputImage, forKey: kCIInputMaskImageKey)
        return blend.outputImage ?? image
    }

    /// Luminantiehistogram (64 bakjes, genormaliseerd) van het camerabeeld.
    private func computeHistogram(from image: CIImage) {
        guard let filter = CIFilter(name: "CIAreaHistogram") else { return }
        filter.setValue(image, forKey: kCIInputImageKey)
        filter.setValue(CIVector(cgRect: image.extent), forKey: kCIInputExtentKey)
        filter.setValue(64, forKey: "inputCount")
        filter.setValue(1.0, forKey: "inputScale")
        guard let output = filter.outputImage else { return }

        var data = [Float](repeating: 0, count: 64 * 4)
        ciContext.render(output,
                         toBitmap: &data,
                         rowBytes: 64 * 4 * MemoryLayout<Float>.size,
                         bounds: CGRect(x: 0, y: 0, width: 64, height: 1),
                         format: .RGBAf,
                         colorSpace: nil)

        var bins = [Float](repeating: 0, count: 64)
        for i in 0..<64 {
            bins[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3.0
        }
        let peak = max(bins.max() ?? 1, 0.0001)
        let normalized = bins.map { min($0 / peak, 1) }
        DispatchQueue.main.async { [weak self] in self?.onHistogram?(normalized) }
    }
}

struct CameraPreview: UIViewRepresentable {
    @ObservedObject var camera: CameraModel
    @ObservedObject var looks: LookManager
    var zebras: Bool
    var histogram: Bool
    var onHistogram: ([Float]) -> Void

    func makeUIView(context: Context) -> PreviewRenderer {
        let view = PreviewRenderer()
        view.onHistogram = onHistogram
        camera.videoOutput.setSampleBufferDelegate(view, queue: context.coordinator.videoQueue)

        // Volumeknoppen + Camera Control als sluiterknop
        let interaction = AVCaptureEventInteraction { [weak camera] event in
            if event.phase == .began { camera?.capture() }
        }
        view.addInteraction(interaction)

        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.tapped(_:)))
        view.addGestureRecognizer(tap)

        // Verticaal vegen = EV-compensatie (alleen in A-stand)
        let pan = UIPanGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.panned(_:)))
        pan.maximumNumberOfTouches = 1
        view.addGestureRecognizer(pan)

        context.coordinator.camera = camera
        return view
    }

    func updateUIView(_ view: PreviewRenderer, context: Context) {
        view.look = looks.activeFilter
        view.vignette = looks.lookEnabled
        view.zebrasEnabled = zebras
        view.histogramEnabled = histogram
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject {
        let videoQueue = DispatchQueue(label: "rauw.video")
        weak var camera: CameraModel?
        private var panStartEV = 0
        private let evHaptic = UIImpactFeedbackGenerator(style: .light)

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view, view.bounds.width > 0, view.bounds.height > 0 else { return }
            let p = gesture.location(in: view)
            camera?.focusSingle(atNormalized: CGPoint(x: p.x / view.bounds.width,
                                                      y: p.y / view.bounds.height))
        }

        @objc func panned(_ gesture: UIPanGestureRecognizer) {
            guard let camera, camera.control == .auto else { return }
            switch gesture.state {
            case .began:
                panStartEV = camera.evThirds
            case .changed:
                // omhoog vegen = lichter; ±28 punt per 1/3 stop
                let dy = -gesture.translation(in: gesture.view).y
                let steps = Int((dy / 28).rounded())
                let newEV = min(max(panStartEV + steps, -9), 9)
                if newEV != camera.evThirds {
                    camera.evThirds = newEV
                    evHaptic.impactOccurred(intensity: 0.6)
                }
            default:
                break
            }
        }
    }
}
