import SwiftUI

struct SettingsSheet: View {
    @ObservedObject var camera: CameraModel
    @ObservedObject var looks: LookManager
    @Binding var grid: Bool
    @Binding var level: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: $grid) { Label("Raster", systemImage: "grid") }
                    Toggle(isOn: $level) { Label("Waterpas", systemImage: "level") }
                    Toggle(isOn: $looks.lookEnabled) {
                        Label("D700-preview in zoeker", systemImage: "camera.filters")
                    }
                } footer: {
                    Text("De D700-preview kleurt alleen de zoeker. De opgeslagen DNG blijft neutraal en krijgt in Lightroom je eigen preset. DNG's zijn 12 MP (±25 MB) — Apple staat buiten ProRAW geen 48 MP RAW toe; net als je D700 dus.")
                }

                Section("Vast in deze app") {
                    LabeledContent("Bestandsformaat", value: "RAW (DNG)")
                    LabeledContent("Scherpstellen", value: "AF-S, tik om scherp te stellen")
                    LabeledContent("Transport", value: "Single shot")
                    LabeledContent("Flitser", value: "Uit")
                    LabeledContent("Witbalans", value: "Auto (alleen DNG-startpunt)")
                }

                Section {
                    Text("Diafragma ligt op iPhone per lens vast; \"A\" werkt daarom als automaat met EV-compensatie en AE-lock (lang indrukken op de sluiterknop). \"M\" geeft handmatige sluitertijd en ISO.")
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
