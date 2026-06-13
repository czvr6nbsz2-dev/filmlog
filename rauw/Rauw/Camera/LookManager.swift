import CoreImage
import Foundation

/// De twee zoeker-looks: kleur (Leica Kleur op basis van het D700-profiel)
/// en zwartwit (Kodak Tri-X-benadering).
enum FilmLook: String, CaseIterable {
    case color
    case mono

    /// Bestandsnaam van de bijbehorende .cube in Looks/.
    var resource: String { self == .color ? "D700" : "TriX" }
    /// Korte naam voor in de zoekerbalk.
    var label: String { self == .color ? "Kleur" : "TriX" }
    var symbol: String { self == .color ? "film" : "circle.lefthalf.filled" }
}

/// Laadt de zoeker-LUT's uit Looks/ en levert het actieve filter aan de
/// Metal-preview. De LUT kleurt alleen de live preview; de opgeslagen DNG
/// blijft neutraal en krijgt in Lightroom je eigen preset.
final class LookManager: ObservableObject {

    @Published var lookEnabled: Bool {
        didSet { UserDefaults.standard.set(lookEnabled, forKey: "lookEnabled") }
    }
    @Published var look: FilmLook {
        didSet { UserDefaults.standard.set(look.rawValue, forKey: "filmLook") }
    }

    private struct Cube { let size: Int; let data: Data }
    private var cubes: [FilmLook: Cube] = [:]
    private var previewFilters: [FilmLook: CIFilter] = [:]

    var lookName: String { look.label }
    var lookSymbol: String { look.symbol }
    /// Gedeelde instantie voor de live preview (alleen door de zoeker-thread).
    var activeFilter: CIFilter? { lookEnabled ? previewFilters[look] : nil }

    init() {
        lookEnabled = UserDefaults.standard.object(forKey: "lookEnabled") as? Bool ?? true
        look = FilmLook(rawValue: UserDefaults.standard.string(forKey: "filmLook") ?? "") ?? .color
        for l in FilmLook.allCases {
            if let cube = Self.loadCube(named: l.resource) {
                cubes[l] = cube
                previewFilters[l] = Self.makeFilter(from: cube)
            }
        }
    }

    /// Wisselt tussen kleur en zwartwit.
    func toggleLook() {
        look = (look == .color) ? .mono : .color
    }

    /// Verse, eigen filterinstantie om de look in de JPG te bakken — los van de
    /// preview, zodat foto- en zoeker-thread niet op dezelfde CIFilter schrijven.
    func makeFilter(for look: FilmLook) -> CIFilter? {
        guard let cube = cubes[look] else { return nil }
        return Self.makeFilter(from: cube)
    }

    private static func loadCube(named name: String) -> Cube? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "cube"),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else { return nil }

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

        guard size > 1, values.count == size * size * size * 4 else { return nil }
        let data = values.withUnsafeBufferPointer { Data(buffer: $0) }
        return Cube(size: size, data: data)
    }

    private static func makeFilter(from cube: Cube) -> CIFilter? {
        guard let filter = CIFilter(name: "CIColorCubeWithColorSpace") else { return nil }
        filter.setValue(cube.size, forKey: "inputCubeDimension")
        filter.setValue(cube.data, forKey: "inputCubeData")
        filter.setValue(CGColorSpace(name: CGColorSpace.sRGB)!, forKey: "inputColorSpace")
        return filter
    }
}
