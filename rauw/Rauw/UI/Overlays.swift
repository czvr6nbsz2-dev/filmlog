import CoreMotion
import SwiftUI
import UIKit

/// Regel-van-derden raster.
struct GridOverlay: View {
    var body: some View {
        GeometryReader { geo in
            Path { path in
                for i in 1...2 {
                    let x = geo.size.width * CGFloat(i) / 3
                    let y = geo.size.height * CGFloat(i) / 3
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: geo.size.height))
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: geo.size.width, y: y))
                }
            }
            .stroke(Color.white.opacity(0.35), lineWidth: 0.5)
        }
        .allowsHitTesting(false)
    }
}

/// Waterpas op basis van de zwaartekracht, met een voelbaar tikje
/// precies op het moment dat de horizon waterpas komt (met hysterese,
/// zodat hij niet blijft natikken rond het omslagpunt).
final class MotionLevel: ObservableObject {
    private let manager = CMMotionManager()
    @Published var degrees: Double = 0
    private var wasLevel = false
    private let haptic = UIImpactFeedbackGenerator(style: .light)

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 30.0
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let gravity = motion?.gravity else { return }
            self.degrees = atan2(gravity.x, -gravity.y) * 180 / .pi
            let tilt = abs(self.degrees)
            if !self.wasLevel, tilt < 1.2 {
                self.wasLevel = true
                self.haptic.impactOccurred()
            } else if self.wasLevel, tilt > 3.0 {
                self.wasLevel = false
            }
        }
    }

    func stop() { manager.stopDeviceMotionUpdates() }
}

struct LevelIndicator: View {
    @ObservedObject var level: MotionLevel

    private var isLevel: Bool { abs(level.degrees) < 1.5 }

    var body: some View {
        Rectangle()
            .fill(isLevel ? Color.green : Color.white.opacity(0.7))
            .frame(width: 110, height: 1.5)
            .rotationEffect(.degrees(-level.degrees))
            .animation(.easeOut(duration: 0.1), value: level.degrees)
            .allowsHitTesting(false)
    }
}

/// AF-S focuskader op het tikpunt.
struct FocusBox: View {
    let point: CGPoint   // genormaliseerd (0–1)

    var body: some View {
        GeometryReader { geo in
            Rectangle()
                .stroke(Color.yellow, lineWidth: 1)
                .frame(width: 84, height: 84)
                .position(x: point.x * geo.size.width, y: point.y * geo.size.height)
                .transition(.opacity)
        }
        .allowsHitTesting(false)
    }
}

/// Houder voor de histogramdata uit de zoeker-renderer.
final class HistogramModel: ObservableObject {
    @Published var bins: [Float] = []
}

/// Klein luminantiehistogram, onopvallend in de hoek van de zoeker.
struct HistogramView: View {
    let bins: [Float]

    var body: some View {
        Canvas { context, size in
            guard bins.count > 1 else { return }
            var path = Path()
            let barWidth = size.width / CGFloat(bins.count)
            for (i, value) in bins.enumerated() {
                let h = CGFloat(value) * size.height
                path.addRect(CGRect(x: CGFloat(i) * barWidth,
                                    y: size.height - h,
                                    width: barWidth,
                                    height: h))
            }
            context.fill(path, with: .color(.white.opacity(0.85)))
        }
        .frame(width: 100, height: 44)
        .background(Color.black.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .allowsHitTesting(false)
    }
}
