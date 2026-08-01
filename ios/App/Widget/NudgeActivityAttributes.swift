import Foundation

#if canImport(ActivityKit)
import ActivityKit

// Shared between the app target (which starts and updates the activity) and the
// widget extension (which renders it), so both must compile this file.
@available(iOS 16.1, *)
public struct NudgeActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// seconds remaining; the widget renders a countdown from this
        public var endsAt: Date
        public var paused: Bool

        public init(endsAt: Date, paused: Bool = false) {
            self.endsAt = endsAt
            self.paused = paused
        }
    }

    public var title: String
    public var category: String
    public var points: Int
    /// SF Symbol name; the webview's mdi icons do not exist natively
    public var symbol: String

    public init(title: String, category: String, points: Int, symbol: String) {
        self.title = title
        self.category = category
        self.points = points
        self.symbol = symbol
    }
}
#endif
