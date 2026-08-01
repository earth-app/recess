import SwiftUI

// Read-only by design. The watch shows the day's ring and what is next; it never
// writes state back, which keeps the sync surface to exactly one direction.
struct ContentView: View {
    @State private var snapshot = RecessSnapshotStore.load()

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                ringView

                if snapshot.isComplete {
                    Text("That's Recess")
                        .font(.headline)
                    Text("Nothing more is waiting.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                } else if let next = snapshot.nextTitle {
                    Text(next)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                    if let points = snapshot.nextPoints {
                        Text("+\(points)")
                            .font(.caption2)
                            .foregroundStyle(.tint)
                    }
                } else {
                    Text("Open Recess on your phone")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                weekStrip

                Text(snapshot.streakLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
        }
        .onAppear { snapshot = RecessSnapshotStore.load() }
        .onReceive(
            NotificationCenter.default.publisher(for: NotificationBridgeWatchDelegate.snapshotChanged)
        ) { _ in
            snapshot = RecessSnapshotStore.load()
        }
    }

    private var ringView: some View {
        ZStack {
            Circle()
                .stroke(.tint.opacity(0.2), lineWidth: 7)
            Circle()
                .trim(from: 0, to: snapshot.fraction)
                .stroke(.tint, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text("\(snapshot.done)")
                    .font(.title3.bold())
                Text("of \(max(snapshot.total, 0))")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 74, height: 74)
        .accessibilityLabel("\(snapshot.done) of \(snapshot.total) resolved today")
    }

    private var weekStrip: some View {
        HStack(spacing: 4) {
            ForEach(Array(snapshot.weekStates.enumerated()), id: \.offset) { _, state in
                Circle()
                    .fill(fill(for: state))
                    .overlay(
                        Circle().strokeBorder(.tint.opacity(state == .grace ? 0.7 : 0), lineWidth: 1)
                    )
                    .frame(width: 7, height: 7)
            }
        }
        .accessibilityLabel("This week: \(snapshot.streakLabel)")
    }

    // a grace day is a rest day, never a failure, so it is never rendered as an error
    private func fill(for state: WeekDayState) -> some ShapeStyle {
        switch state {
        case .filled: return AnyShapeStyle(.tint)
        case .grace: return AnyShapeStyle(.tint.opacity(0.25))
        case .empty: return AnyShapeStyle(.gray.opacity(0.3))
        case .future: return AnyShapeStyle(.gray.opacity(0.12))
        }
    }
}

#Preview {
    ContentView()
}
