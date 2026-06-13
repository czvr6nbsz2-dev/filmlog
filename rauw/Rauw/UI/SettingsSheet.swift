import SwiftUI

struct SettingsSheet: View {
    @ObservedObject var camera: CameraModel
    @ObservedObject var looks: LookManager
    @Binding var grid: Bool
    @Binding var level: Bool
    @Binding var zebras: Bool
    @Binding var histogram: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: $grid) { Label("Raster", systemImage: "grid") }
                    Toggle(isOn: $level) { Label("Waterpas (met haptisch tikje)", systemImage: "level") }
                    Toggle(isOn: $zebras) { Label("Zebra's (overbelichting)", systemImage: "exclamationmark.triangle") }
                    Toggle(isOn: $histogram) { Label("Histogram", systemImage: "chart.bar") }
                    Toggle(isOn: $looks.lookEnabled) {
                        Label("Filmlook in zoeker", systemImage: "camera.filters")
                    }
                    Picker(selection: $looks.look) {
                        Text("Kleur (Leica)").tag(FilmLook.color)
                        Text("Zwartwit (Tri-X)").tag(FilmLook.mono)
                    } label: {
                        Label("Look", systemImage: "circle.lefthalf.filled")
                    }
                    .disabled(!looks.lookEnabled)
                    Toggle(isOn: $looks.grainEnabled) {
                        Label("Filmkorrel (zwartwit)", systemImage: "circle.grid.3x3.fill")
                    }
                    .disabled(!(looks.lookEnabled && looks.look == .mono))
                } footer: {
                    Text("Elke opname bewaart twee bestanden: een neutrale DNG voor Lightroom (je eigen preset) én een JPG mét de look er al in gebakken — handig om te WhatsAppen. Kleur is de Leica-look; zwartwit benadert Kodak Tri-X (pittig, iets zachter dan vol) met een fijne filmkorrel in zoeker en JPG. Tik op de filmnaam bovenin om snel te wisselen. DNG's zijn 12 MP (±25 MB) — Apple staat buiten ProRAW geen 48 MP RAW toe; net als je D700 dus.")
                }

                Section("Vast in deze app") {
                    LabeledContent("Bestandsformaat", value: "RAW (DNG)")
                    LabeledContent("Scherpstellen", value: "AF-S, tik om scherp te stellen")
                    LabeledContent("Transport", value: "Single shot")
                    LabeledContent("Flitser", value: "Uit")
                    LabeledContent("Witbalans", value: "Auto (alleen DNG-startpunt)")
                }

                Section {
                    Text("Diafragma ligt op iPhone per lens vast; \"A\" werkt daarom als automaat met EV-compensatie en AE-lock (lang indrukken op de sluiterknop; een tik in de zoeker ontgrendelt weer). EV stel je ook in door verticaal over de zoeker te vegen. Zebra's en histogram meten het opnamebeeld, vóór de filmlook. \"M\" geeft handmatige sluitertijd en ISO.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Instellingen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
