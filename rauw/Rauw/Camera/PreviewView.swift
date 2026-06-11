import AVFoundation
import AVKit
import CoreImage
import MetalKit
import SwiftUI

/// Metal-zoeker: ontvangt cameraframes, past optioneel de D700-LUT
/// (+ subtiel vignet, zoals in het LR-profiel) toe en tekent ze.
final class PreviewRenderer: MTKView, MTKViewDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {

    private var commandQueue: MTLCommandQueue!
    private var ciContext: CIContext!
    private let renderColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private let imageLock = NSLock()
    private var latestImage: CIImage?

    var look: CIFilter?
    var vignette = false

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
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        imageLock.lock()
        let snapshot = latestImage
        imageLock.unlock()
        guard var image = snapshot,
              let drawable = currentDrawable,
              let buffer = commandQueue?.makeCommandBuffer()
        else { return }

        if let look {
            look.setValue(image, forKey: kCIInputImageKey)
            if let output = look.outputImage { image = output }
        }

        let size = drawableSize
        guard size.width > 0, size.height > 0, image.extent.width > 0 else { return }
        let scale = max(size.width / image.extent.width, size.height / image.extent.height)
        image = image
            .transformed(by: .init(translationX: -image.extent.origin.x, y: -image.extent.origin.y))
            .transformed(by: .init(scaleX: scale, y: scale))
            .cropped(to: CGRect(origin: .zero, size: size))

        if look != nil, vignette, let v = CIFilter(name: "CIVignette") {
            v.setValue(image, forKey: kCIInputImageKey)
            v.setValue(0.5, forKey: kCIInputIntensityKey)
            v.setValue(1.8, forKey: kCIInputRadiusKey)
            if let output = v.outputImage { image = output.cropped(to: CGRect(origin: .zero, size: size)) }
        }

        ciContext.render(image,
                         to: drawable.texture,
                         commandBuffer: buffer,
                         bounds: CGRect(origin: .zero, size: size),
                         colorSpace: renderColorSpace)
        buffer.present(drawable)
        buffer.commit()
    }
}

struct CameraPreview: UIViewRepresentable {
    @ObservedObject var camera: CameraModel
    @ObservedObject var looks: LookManager

    func makeUIView(context: Context) -> PreviewRenderer {
        let view = PreviewRenderer()
        camera.videoOutput.setSampleBufferDelegate(view, queue: context.coordinator.videoQueue)

        // Volumeknoppen + Camera Control als sluiterknop
        let interaction = AVCaptureEventInteraction { [weak camera] event in
            if event.phase == .began { camera?.capture() }
        }
        view.addInteraction(interaction)

        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.tapped(_:)))
        view.addGestureRecognizer(tap)
        context.coordinator.camera = camera
        return view
    }

    func updateUIView(_ view: PreviewRenderer, context: Context) {
        view.look = looks.activeFilter
        view.vignette = looks.lookEnabled
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject {
        let videoQueue = DispatchQueue(label: "rauw.video")
        weak var camera: CameraModel?

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view, view.bounds.width > 0, view.bounds.height > 0 else { return }
            let p = gesture.location(in: view)
            camera?.focusSingle(atNormalized: CGPoint(x: p.x / view.bounds.width,
                                                      y: p.y / view.bounds.height))
        }
    }
}
