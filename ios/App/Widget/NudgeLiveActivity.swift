import SwiftUI
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
struct NudgeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NudgeActivityAttributes.self) { context in
            lockScreenView(context)
                .activityBackgroundTint(Color.black.opacity(0.35))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.attributes.symbol)
                        .foregroundStyle(.tint)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                        .monospacedDigit()
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.caption)
                        .lineLimit(2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("+\(context.attributes.points) when you finish")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                Image(systemName: context.attributes.symbol)
            } compactTrailing: {
                Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                    .monospacedDigit()
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: context.attributes.symbol)
            }
        }
    }

    @ViewBuilder
    private func lockScreenView(
        _ context: ActivityViewContext<NudgeActivityAttributes>
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: context.attributes.symbol)
                .font(.title2)
                .foregroundStyle(.tint)

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                Text(context.attributes.category.capitalized)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                .monospacedDigit()
                .font(.title3)
        }
        .padding()
    }
}
#endif
