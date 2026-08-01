import SwiftUI
import WidgetKit

// Static configuration: the widget takes no user options, so the Xcode template's
// AppIntentConfiguration and its favorite-emoji parameter are gone.

struct RecessEntry: TimelineEntry {
    let date: Date
    let snapshot: RecessSnapshot
}

struct RecessProvider: TimelineProvider {
    func placeholder(in context: Context) -> RecessEntry {
        RecessEntry(date: Date(), snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (RecessEntry) -> Void) {
        completion(RecessEntry(date: Date(), snapshot: RecessSnapshotStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecessEntry>) -> Void) {
        let now = Date()
        let entry = RecessEntry(date: now, snapshot: RecessSnapshotStore.load())

        // refresh at the next day boundary rather than on a fixed hourly cadence;
        // the day's set only changes at midnight, and the app pushes a fresh
        // snapshot whenever anything is resolved
        let midnight = Calendar.current.nextDate(
            after: now,
            matching: DateComponents(hour: 0, minute: 1),
            matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(3600)

        let nextNudge = min(midnight, now.addingTimeInterval(60 * 30))
        completion(Timeline(entries: [entry], policy: .after(nextNudge)))
    }
}

struct RingView: View {
    let fraction: Double
    let done: Int
    let total: Int
    var lineWidth: CGFloat = 8

    var body: some View {
        ZStack {
            Circle().stroke(.tint.opacity(0.2), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(.tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: -1) {
                Text("\(done)").font(.title2.bold())
                Text("of \(total)").font(.system(size: 10)).foregroundStyle(.secondary)
            }
        }
    }
}

struct WeekStripView: View {
    let states: [WeekDayState]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(states.enumerated()), id: \.offset) { _, state in
                Circle()
                    .fill(fill(for: state))
                    .overlay(
                        Circle().strokeBorder(.tint.opacity(state == .grace ? 0.7 : 0), lineWidth: 1)
                    )
                    .frame(width: 6, height: 6)
            }
        }
    }

    private func fill(for state: WeekDayState) -> AnyShapeStyle {
        switch state {
        case .filled: return AnyShapeStyle(.tint)
        case .grace: return AnyShapeStyle(.tint.opacity(0.25))
        case .empty: return AnyShapeStyle(.gray.opacity(0.3))
        case .future: return AnyShapeStyle(.gray.opacity(0.12))
        }
    }
}

struct RecessWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: RecessEntry

    var body: some View {
        switch family {
        case .systemSmall:
            smallView
        default:
            mediumView
        }
    }

    private var smallView: some View {
        VStack(spacing: 6) {
            RingView(
                fraction: entry.snapshot.fraction,
                done: entry.snapshot.done,
                total: entry.snapshot.total
            )
            .frame(width: 64, height: 64)

            Text(entry.snapshot.isComplete ? "That's Recess" : "Recess")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var mediumView: some View {
        HStack(spacing: 14) {
            RingView(
                fraction: entry.snapshot.fraction,
                done: entry.snapshot.done,
                total: entry.snapshot.total
            )
            .frame(width: 62, height: 62)

            VStack(alignment: .leading, spacing: 5) {
                if entry.snapshot.isComplete {
                    Text("That's Recess").font(.headline)
                    Text("Nothing more is waiting.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if let next = entry.snapshot.nextTitle {
                    Text(next).font(.subheadline.weight(.medium)).lineLimit(2)
                    if let points = entry.snapshot.nextPoints {
                        Text("+\(points)").font(.caption2).foregroundStyle(.tint)
                    }
                } else {
                    Text("Recess").font(.headline)
                    Text("Open the app for today's nudges.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
                WeekStripView(states: entry.snapshot.weekStates)
                Text("\(entry.snapshot.points) points")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
    }
}

extension View {
    /// `containerBackground` is iOS 17+, but this target supports 16.1
    @ViewBuilder
    func recessWidgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(.fill.tertiary, for: .widget)
        } else {
            padding()
        }
    }
}

struct RecessWidget: Widget {
    let kind = "RecessWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RecessProvider()) { entry in
            RecessWidgetEntryView(entry: entry)
                .recessWidgetBackground()
        }
        .configurationDisplayName("Today")
        .description("Your day's nudges, the week so far, and what is next.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// the widget target's floor is iOS 16.1 (ActivityKit); the preview macro is 17+
@available(iOS 17.0, *)
#Preview(as: .systemMedium) {
    RecessWidget()
} timeline: {
    RecessEntry(
        date: .now,
        snapshot: RecessSnapshot(
            done: 2,
            total: 4,
            points: 340,
            streak: 5,
            streakLabel: "5 Days",
            nextTitle: "Find a leaf with a hole chewed through it",
            nextIcon: "mdi:leaf",
            nextPoints: 10,
            week: "ffgff-f",
            updatedAt: 0
        )
    )
}
