import SwiftUI

struct ContentView: View {
    @StateObject private var camera = CameraModel()
    @StateObject private var looks = LookManager()
    @StateObject private var motion = MotionLevel()
    @StateObject private var histogram = HistogramModel()
    @State private var showSettings = false
    @AppStorage("grid") private var grid = false
    @AppStorage("level") private var level = false
    @AppStorage("zebras") private var zebras = true
    @AppStorage("histogram") private var histogramOn = true

    var body: some View {
        VStack(spacing: 0) {
            topBar
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

            viewfinder

            Spacer(minLength: 0)

            if camera.control == .manual { manualChips }

            controlRow
                .padding(.horizontal, 20)
                .padding(.top, 12)

            bottomRow
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
        }
        .background(Color.black.ignoresSafeArea())
        .font(.system(.body, design: .monospaced))
        .onAppear {
            camera.start()
            if level { motion.start() }
        }
        .onDisappear { camera.stop() }
        .onChange(of: level) { _, on in
            if on { motion.start() } else { motion.stop() }
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet(camera: camera, looks: looks, grid: $grid, level: $level,
                          zebras: $zebras, histogram: $histogramOn)
        }
        .overlay(alignment: .top) { statusToast }
    }

    // MARK: - Bovenbalk

    private var topBar: some View {
        HStack(spacing: 14) {
            Button { showSettings = true } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 20))
                    .foregroundStyle(.white)
            }

            Spacer()

            Button { looks.lookEnabled.toggle() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "film")
                    Text(looks.lookEnabled ? looks.lookName : "—")
                }
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundStyle(looks.lookEnabled ? .yellow : .gray)
            }

            Spacer()

            HStack(spacing: 5) {
                Image(systemName: "camera.aperture")
                Text(camera.displayShutter)
            }
            .foregroundStyle(.yellow)
            .font(.system(size: 15, weight: .semibold, design: .monospaced))

            Text("ISO \(camera.displayISO)")
                .foregroundStyle(.yellow)
                .font(.system(size: 15, weight: .bold, design: .monospaced))

            Text(camera.rawAvailable ? "RAW" : "HEIF")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(camera.rawAvailable ? .green : .orange)
        }
    }

    // MARK: - Zoeker

    private var viewfinder: some View {
        ZStack {
            CameraPreview(camera: camera, looks: looks,
                          zebras: zebras, histogram: histogramOn,
                          onHistogram: { histogram.bins = $0 })
                .aspectRatio(3.0 / 4.0, contentMode: .fit)
                .clipped()

            if grid { GridOverlay() }
            if level { LevelIndicator(level: motion) }
            if let p = camera.focusIndicator { FocusBox(point: p) }

            VStack {
                Spacer()
                lensPicker.padding(.bottom, 14)
            }
        }
        .overlay(alignment: .topTrailing) {
            if histogramOn {
                HistogramView(bins: histogram.bins).padding(10)
            }
        }
        .aspectRatio(3.0 / 4.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
    }

    private var lensPicker: some View {
        HStack(spacing: 26) {
            ForEach(RearLens.allCases, id: \.rawValue) { l in
                Button {
                    if camera.isFront { camera.isFront = false }
                    camera.lens = l
                } label: {
                    VStack(spacing: 0) {
                        Text(l.label)
                            .font(.system(size: 17, weight: .semibold, design: .monospaced))
                        Text("mm")
                            .font(.system(size: 11, design: .monospaced))
                    }
                    .foregroundStyle(!camera.isFront && camera.lens == l ? .yellow : .white)
                    .frame(width: 56, height: 56)
                    .background(
                        Circle().fill(Color.black.opacity(!camera.isFront && camera.lens == l ? 0.45 : 0.0))
                    )
                }
            }
        }
    }

    // MARK: - Bedieningsrij

    private var controlRow: some View {
        HStack {
            Button {
                camera.control = camera.control == .auto ? .manual : .auto
            } label: {
                Text(camera.control.rawValue)
                    .font(.system(size: 22, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(Color.white.opacity(0.12)))
            }

            Spacer()

            shutterButton

            Spacer()

            HStack(spacing: 10) {
                Text(String(format: "%+.1f", Double(camera.evThirds) / 3.0))
                    .font(.system(size: 17, weight: .semibold, design: .monospaced))
                    .foregroundStyle(camera.evThirds == 0 ? .white : .yellow)
                    .frame(width: 56, alignment: .trailing)

                HStack(spacing: 0) {
                    Button { camera.evThirds = max(camera.evThirds - 1, -9) } label: {
                        Image(systemName: "minus").frame(width: 40, height: 40)
                    }
                    Divider().frame(height: 22)
                    Button { camera.evThirds = min(camera.evThirds + 1, 9) } label: {
                        Image(systemName: "plus").frame(width: 40, height: 40)
                    }
                }
                .foregroundStyle(.white)
                .background(Capsule().fill(Color.white.opacity(0.12)))
            }
            .opacity(camera.control == .auto ? 1 : 0.25)
            .disabled(camera.control != .auto)
        }
    }

    /// Tik = foto; lang indrukken = AE-lock aan/uit (alleen in A-stand).
    private var shutterButton: some View {
        ZStack {
            Circle()
                .fill(Color.yellow)
                .frame(width: 78, height: 78)
            Circle()
                .stroke(Color.white, lineWidth: 2)
                .frame(width: 88, height: 88)
            if camera.aeLocked {
                Image(systemName: "lock.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.black)
            }
        }
        .opacity(camera.isCapturing ? 0.5 : 1)
        .contentShape(Circle())
        .onTapGesture { camera.capture() }
        .onLongPressGesture(minimumDuration: 0.4) {
            guard camera.control == .auto else { return }
            camera.aeLocked.toggle()
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
    }

    // MARK: - Handmatige sluiter/ISO-keuze

    private var manualChips: some View {
        VStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Text("SS").foregroundStyle(.gray).font(.system(size: 12, design: .monospaced))
                    ForEach(CameraModel.shutterSpeeds, id: \.self) { s in
                        chip(CameraModel.shutterLabel(s), selected: abs(camera.manualShutter - s) < 1e-9) {
                            camera.manualShutter = s
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Text("ISO").foregroundStyle(.gray).font(.system(size: 12, design: .monospaced))
                    ForEach(CameraModel.isoValues, id: \.self) { iso in
                        chip("\(Int(iso))", selected: camera.manualISO == iso) {
                            camera.manualISO = iso
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.top, 8)
    }

    private func chip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundStyle(selected ? .black : .white)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(selected ? Color.yellow : Color.white.opacity(0.12)))
        }
    }

    // MARK: - Onderbalk

    private var bottomRow: some View {
        HStack {
            // Plekhouder houdt het AF-S-label gecentreerd
            Color.clear.frame(width: 48, height: 48)

            Spacer()

            Text("AF-S")
                .font(.system(size: 15, design: .monospaced))
                .foregroundStyle(.gray)

            Spacer()

            Button { camera.isFront.toggle() } label: {
                Image(systemName: "arrow.triangle.2.circlepath.camera")
                    .font(.system(size: 20))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(Color.white.opacity(0.12)))
            }
        }
    }

    // MARK: - Statusmelding

    @ViewBuilder
    private var statusToast: some View {
        if let message = camera.statusMessage {
            Text(message)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(Color.red.opacity(0.85)))
                .padding(.top, 8)
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                        if camera.statusMessage == message { camera.statusMessage = nil }
                    }
                }
        }
    }
}
