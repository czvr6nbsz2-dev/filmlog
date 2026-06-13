import CoreImage
import CoreGraphics

/// Fijne, organische filmkorrel als losse renderstap. Korrel is ruimtelijke
/// ruis en kan dus niet in een kleur-LUT (.cube) zitten; we blenden hem hier
/// over het beeld. Gedeeld door de live zoeker en de opgeslagen JPG.
///
/// De truc voor "film" i.p.v. "digitale ruis": de ruis wordt vergroot tot
/// korrels en licht vervaagd, zodat het zachte klontjes worden in plaats van
/// scherpe losse pixels. Daarna subtiel via soft-light overgeblend.
enum FilmGrain {

    /// `intensity` ~0–1: hoe sterk de korrel doorkomt (default subtiel).
    static func apply(to image: CIImage, intensity: CGFloat = 0.35) -> CIImage {
        let extent = image.extent
        guard extent.width > 1, extent.height > 1,
              let noise = CIFilter(name: "CIRandomGenerator")?.outputImage
        else { return image }

        // Korrelgrootte schaalt mee met de beeldgrootte (referentie ±950 px),
        // zodat de zoeker en de veel grotere JPG dezelfde grofheid tonen.
        let particle = max(1.0, extent.width / 950.0)

        // 1) grijswaarde-ruis rond 0.5  2) vergroten tot korrels
        // 3) licht vervagen -> organische klontjes i.p.v. harde pixels
        let grain = noise
            .applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: 0.333, y: 0.333, z: 0.333, w: 0),
                "inputGVector": CIVector(x: 0.333, y: 0.333, z: 0.333, w: 0),
                "inputBVector": CIVector(x: 0.333, y: 0.333, z: 0.333, w: 0),
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 1),
            ])
            .transformed(by: CGAffineTransform(scaleX: particle, y: particle))
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: particle])
            // Na de blur is de ruis laag-contrast; rond grijs (0.5) wat
            // terugbrengen, geschaald door intensity, zodat soft-light subtiel
            // moduleert i.p.v. de hele foto te overspoelen.
            .applyingFilter("CIColorControls", parameters: [
                kCIInputSaturationKey: 0.0,
                kCIInputContrastKey: 1.0 + intensity,
                kCIInputBrightnessKey: 0.0,
            ])
            .cropped(to: extent)

        // Soft light: grijs = neutraal, afwijkingen lichten/donkeren subtiel.
        return grain
            .applyingFilter("CISoftLightBlendMode", parameters: [kCIInputBackgroundImageKey: image])
            .cropped(to: extent)
    }
}
