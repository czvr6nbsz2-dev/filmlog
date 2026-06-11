import CoreMotion
import SwiftUI

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

/// Waterpas op basis van de zwaartekracht.
final class MotionLevel: ObservableObject {
    private let manager = CMMotionManager()
    @Published var degrees: Double = 0

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 30.0
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let gravity = motion?.gravity else { return }
            self?.degrees = atan2(gravity.x, -gravity.y) * 180 / .pi
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
