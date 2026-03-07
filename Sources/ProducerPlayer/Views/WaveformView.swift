import SwiftUI

struct WaveformView: View {
    let samples: [CGFloat]

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let height = geo.size.height

            Canvas { context, size in
                guard !samples.isEmpty else { return }

                var path = Path()
                let step = width / CGFloat(max(samples.count - 1, 1))

                path.move(to: CGPoint(x: 0, y: height / 2))

                for (index, sample) in samples.enumerated() {
                    let x = CGFloat(index) * step
                    let amplitude = min(max(sample, 0.0), 1.0)
                    let y = (height / 2) - (amplitude * height * 0.45)
                    path.addLine(to: CGPoint(x: x, y: y))
                }

                for (index, sample) in samples.enumerated().reversed() {
                    let x = CGFloat(index) * step
                    let amplitude = min(max(sample, 0.0), 1.0)
                    let y = (height / 2) + (amplitude * height * 0.45)
                    path.addLine(to: CGPoint(x: x, y: y))
                }

                path.closeSubpath()
                context.fill(path, with: .color(.accentColor.opacity(0.35)))

                var line = Path()
                line.move(to: CGPoint(x: 0, y: height / 2))
                line.addLine(to: CGPoint(x: width, y: height / 2))
                context.stroke(line, with: .color(.secondary.opacity(0.3)), lineWidth: 1)
            }
        }
        .frame(minHeight: 120)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.secondary.opacity(0.08))
        )
    }
}
