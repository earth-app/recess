import Foundation

// The App Group is the whole bridge. The phone writes one JSON blob under this
// key via Capacitor Preferences (which maps to UserDefaults), and both the Watch
// and the Widget read it. No custom plugin involved.

public struct RecessSnapshot: Codable, Equatable {
    public var done: Int
    public var total: Int
    public var points: Int
    public var streak: Int
    public var streakLabel: String
    public var nextTitle: String?
    public var nextIcon: String?
    public var nextPoints: Int?
    /// 7 characters, oldest first: f=filled g=grace e=empty -=future
    public var week: String
    public var updatedAt: Double

    public static let empty = RecessSnapshot(
        done: 0,
        total: 0,
        points: 0,
        streak: 0,
        streakLabel: "Start Something Today",
        nextTitle: nil,
        nextIcon: nil,
        nextPoints: nil,
        week: "-------",
        updatedAt: 0
    )

    public var fraction: Double {
        total > 0 ? min(1, Double(done) / Double(total)) : 0
    }

    public var isComplete: Bool {
        total > 0 && done >= total
    }
}

public enum RecessSnapshotStore {
    public static let appGroup = "group.com.earthapp.recess"
    public static let key = "recess.snapshot.v1"

    /// Capacitor Preferences prefixes its keys, so try both the raw key and the
    /// prefixed form rather than guessing which one this plugin version wrote.
    private static let candidateKeys = [
        key,
        "CapacitorStorage.\(key)"
    ]

    public static func load() -> RecessSnapshot {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return .empty }

        for candidate in candidateKeys {
            guard let raw = defaults.string(forKey: candidate),
                  let data = raw.data(using: .utf8),
                  let decoded = try? JSONDecoder().decode(RecessSnapshot.self, from: data)
            else { continue }
            return decoded
        }

        return .empty
    }
}

public enum WeekDayState {
    case filled
    case grace
    case empty
    case future

    public static func parse(_ character: Character) -> WeekDayState {
        switch character {
        case "f": return .filled
        case "g": return .grace
        case "-": return .future
        default: return .empty
        }
    }
}

public extension RecessSnapshot {
    var weekStates: [WeekDayState] {
        week.map(WeekDayState.parse)
    }
}
