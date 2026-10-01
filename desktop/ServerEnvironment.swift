import Foundation

enum ServerSignal: Equatable {
    case ready
    case updateRequested
}

enum ServerEnvironment {
    private static let transientCodexKeys: Set<String> = [
        "CODEX_APP_TOOLS_PIPE_PATH",
        "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
        "CODEX_SESSION_ID",
        "CODEX_THREAD_ID",
    ]

    static func sanitized(_ source: [String: String]) -> [String: String] {
        var result = source
        for key in transientCodexKeys {
            result.removeValue(forKey: key)
        }
        for (key, value) in result where key != "PATH" && value.contains("/Volumes/") {
            result.removeValue(forKey: key)
        }
        let safePath = (source["PATH"] ?? "")
            .split(separator: ":", omittingEmptySubsequences: true)
            .map(String.init)
            .filter { !$0.hasPrefix("/Volumes/") }
            .joined(separator: ":")
        result["PATH"] = safePath.isEmpty ? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" : safePath
        return result
    }

    static func signal(in line: String) -> ServerSignal? {
        if line.contains("CODEX_LOOKOUT_UPDATE_REQUEST") { return .updateRequested }
        if line.contains("CODEX_LOOKOUT_READY") || line.contains("Codex 瞭望台已启动") { return .ready }
        return nil
    }
}
