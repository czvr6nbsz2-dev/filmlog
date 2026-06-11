import CoreImage
import Foundation

/// Laadt de zoeker-LUT (benadering van het Lightroom-profiel
/// "D700 + Nikkor 50mm f/1.4 AI + Leica Kleur") uit Looks/D700.cube.
/// De LUT kleurt alleen de live preview; de opgeslagen DNG blijft neutraal.
final class LookManager: ObservableObject {

    @Published var lookEnabled: Bool {
        didSet { UserDefaults.standard.set(lookEnabled, forKey: "lookEnabled") }
    }

    let lookName = "D700"
    private(set) var cubeFilter: CIFilter?

    var activeFilter: CIFilter? { lookEnabled ? cubeFilter : nil }

    init() {
        lookEnabled = UserDefaults.standard.object(forKey: "lookEnabled") as? Bool ?? true
        loadCube()
    }

    private func loadCube() {
        guard let url = Bundle.main.url(forResource: "D700", withExtension: "cube"),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else { return }

        var size = 0
        var values: [Float] = []
        values.reserveCapacity(33 * 33 * 33 * 4)

        for rawLine in text.split(separator: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") || line.hasPrefix("TITLE") { continue }
            if line.hasPrefix("LUT_3D_SIZE") {
                size = Int(line.split(separator: " ").last ?? "0") ?? 0
                continue
            }
            let parts = line.split(separator: " ").compactMap { Float($0) }
            if parts.count == 3 {
                values.append(contentsOf: parts)
                values.append(1.0)
            }
        }

        guard size > 1, values.count == size * size * size * 4 else { return }
        let data = values.withUnsafeBufferPointer { Data(buffer: $0) }

        guard let filter = CIFilter(name: "CIColorCubeWithColorSpace") else { return }
        filter.setValue(size, forKey: "inputCubeDimension")
        filter.setValue(data, forKey: "inputCubeData")
        filter.setValue(CGColorSpace(name: CGColorSpace.sRGB)!, forKey: "inputColorSpace")
        cubeFilter = filter
    }
}
