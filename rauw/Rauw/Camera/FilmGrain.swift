import CoreImage
import CoreGraphics

/// Fijne, monochrome filmkorrel als losse renderstap. Korrel is ruimtelijke
/// ruis en kan dus niet in een kleur-LUT (.cube) zitten; we blenden hem hier
/// over het beeld. Gedeeld door de live zoeker en de opgeslagen JPG, zodat de
/// korrel er in beide even grof uitziet.
enum FilmGrain {

    /// `strength` 0–1: hoeveel de korrel afwijkt van neutraalgrijs.
    /// De korrelgrootte schaalt mee met de beeldgrootte (referentie ±1100 px
    /// breed), zodat de zoeker en de veel grotere JPG dezelfde grofheid tonen.
    static func apply(to image: CIImage, strength: CGFloat = 0.5) -> CIImage {
        let extent = image.extent
        guard extent.width > 1, extent.height > 1,
              let noise = CIFilter(name: "CIRandomGenerator")?.outputImage
        else { return image }

        let grainScale = max(1.0, extent.width / 1100.0)
        let half = strength / 2
        let w = 0.333 * strength

        // Grijswaarde-ruis rond 0.5, amplitude ~strength/2.
        let grain = noise
            .applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: w, y: w, z: w, w: 0),
                "inputGVector": CIVector(x: w, y: w, z: w, w: 0),
                "inputBVector": CIVector(x: w, y: w, z: w, w: 0),
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
                "inputBiasVector": CIVector(x: 0.5 - half, y: 0.5 - half, z: 0.5 - half, w: 1),
            ])
            .transformed(by: CGAffineTransform(scaleX: grainScale, y: grainScale))
            .cropped(to: extent)

        // Soft light: grijs = neutraal, afwijkingen lichten/donkeren subtiel.
        return grain
            .applyingFilter("CISoftLightBlendMode", parameters: [kCIInputBackgroundImageKey: image])
            .cropped(to: extent)
    }
}
