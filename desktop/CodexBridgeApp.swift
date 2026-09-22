import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins

@main
final class CodexBridgeApp: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private static var retainedDelegate: CodexBridgeApp?

    static func main() {
        if runCommandLineMode() { return }
        let delegate = CodexBridgeApp()
        retainedDelegate = delegate
        let application = NSApplication.shared
        application.delegate = delegate
        application.run()
    }

    private static func runCommandLineMode() -> Bool {
        let arguments = CommandLine.arguments
        guard arguments.count > 1 else { return false }
        let hostVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let store = CoreUpdateStore(hostVersion: hostVersion)
        switch arguments[1] {
        case "--effective-version":
            print(store.effectiveVersion())
            return true
        case "--restore-bundled-core":
            store.restore(directoryName: nil)
            print(hostVersion)
            return true
        case "--install-core-update":
            guard arguments.count == 5 else {
                fputs("Usage: CodexLocalHub --install-core-update <archive.zip> <version> <sha256>\n", stderr)
                exit(64)
            }
            do {
                let activation = try store.install(
                    archive: URL(fileURLWithPath: arguments[2]),
                    expectedVersion: arguments[3],
                    expectedSHA256: arguments[4]
                )
                print(activation.version)
                return true
            } catch {
                fputs("Core update failed: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        default:
            return false
        }
    }

    private var window: NSWindow!
    private var serverProcess: Process?
    private var outputBuffer = ""
    private var bestAddressScore = -1
    private var shouldRestart = true
    private var restartAttempts = 0
    private var restartWorkItem: DispatchWorkItem?
    private var updateTimer: Timer?
    private var availableUpdate: UpdateRelease?
    private var updateChecker: GitHubUpdateChecker!
    private var pendingCoreActivation: CoreActivation?
    private var isSwitchingCore = false
    private var coreStartupWorkItem: DispatchWorkItem?
    private lazy var hostVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    private lazy var coreStore = CoreUpdateStore(hostVersion: hostVersion)

    private var isChinese: Bool { Locale.preferredLanguages.first?.lowercased().hasPrefix("zh") == true }
    private func text(_ zh: String, _ en: String) -> String { isChinese ? zh : en }

    private let statusDot = NSView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let addressLabel = NSTextField(labelWithString: "")
    private let hintLabel = NSTextField(labelWithString: "")
    private let qrImageView = NSImageView()
    private let openButton = NSButton(title: "", target: nil, action: nil)
    private let copyButton = NSButton(title: "", target: nil, action: nil)
    private let toggleButton = NSButton(title: "", target: nil, action: nil)
    private let updateButton = NSButton(title: "", target: nil, action: nil)
    private let versionLabel = NSTextField(labelWithString: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        startServer()
        configureUpdateChecks()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        shouldRestart = false
        restartWorkItem?.cancel()
        coreStartupWorkItem?.cancel()
        updateTimer?.invalidate()
        stopServer()
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 600),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Codex Local Hub"
        window.appearance = NSAppearance(named: .darkAqua)
        window.center()
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(calibratedRed: 0.035, green: 0.047, blue: 0.075, alpha: 1)

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(calibratedRed: 0.035, green: 0.047, blue: 0.075, alpha: 1).cgColor
        root.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = root

        let badge = NSTextField(labelWithString: "CODEX LOCAL HUB · LAN")
        badge.font = .systemFont(ofSize: 11, weight: .semibold)
        badge.textColor = NSColor(calibratedRed: 0.49, green: 0.67, blue: 1, alpha: 1)
        badge.alignment = .center

        let title = NSTextField(labelWithString: text("Codex 随身工作台", "Your Codex workspace, on your phone"))
        title.font = .systemFont(ofSize: 25, weight: .bold)
        title.textColor = .white
        title.alignment = .center

        let subtitle = NSTextField(wrappingLabelWithString: text("Mac 与手机连接同一个可信 Wi-Fi，扫描二维码即可直接打开工作台。", "Keep your Mac and phone on the same trusted Wi-Fi, then scan the QR code to open the workspace directly."))
        subtitle.font = .systemFont(ofSize: 14, weight: .regular)
        subtitle.textColor = NSColor(calibratedWhite: 0.68, alpha: 1)
        subtitle.alignment = .center
        subtitle.maximumNumberOfLines = 2

        statusLabel.stringValue = text("正在启动本机服务…", "Starting the local service…")
        addressLabel.stringValue = text("正在获取局域网地址", "Finding your local network address")
        hintLabel.stringValue = text("局域网模式 · Mac 与手机需连接同一个 Wi-Fi", "Local network mode · keep your Mac and phone on the same Wi-Fi")
        openButton.title = text("在 Mac 上打开", "Open on this Mac")
        copyButton.title = text("复制手机地址", "Copy phone address")
        toggleButton.title = text("停止服务", "Stop service")
        updateButton.title = text("检查是否有新版本", "Check for a new version")
        versionLabel.stringValue = text("当前版本 v\(coreStore.effectiveVersion())", "Current version v\(coreStore.effectiveVersion())")
        versionLabel.font = .systemFont(ofSize: 12, weight: .medium)
        versionLabel.textColor = NSColor(calibratedWhite: 0.62, alpha: 1)
        versionLabel.alignment = .center

        statusDot.wantsLayer = true
        statusDot.layer?.cornerRadius = 5
        statusDot.layer?.backgroundColor = NSColor.systemOrange.cgColor
        statusDot.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 13, weight: .medium)
        statusLabel.textColor = NSColor(calibratedWhite: 0.78, alpha: 1)
        let statusRow = NSStackView(views: [statusDot, statusLabel])
        statusRow.orientation = .horizontal
        statusRow.spacing = 8
        statusRow.alignment = .centerY

        let addressCard = NSView()
        addressCard.wantsLayer = true
        addressCard.layer?.cornerRadius = 18
        addressCard.layer?.borderWidth = 1
        addressCard.layer?.borderColor = NSColor(calibratedWhite: 1, alpha: 0.09).cgColor
        addressCard.layer?.backgroundColor = NSColor(calibratedRed: 0.07, green: 0.09, blue: 0.14, alpha: 0.92).cgColor
        addressCard.translatesAutoresizingMaskIntoConstraints = false

        let addressCaption = NSTextField(labelWithString: text("手机访问地址", "PHONE ACCESS ADDRESS"))
        addressCaption.font = .systemFont(ofSize: 11, weight: .semibold)
        addressCaption.textColor = NSColor(calibratedWhite: 0.53, alpha: 1)
        addressCaption.alignment = .center
        addressLabel.font = .monospacedSystemFont(ofSize: 18, weight: .semibold)
        addressLabel.textColor = .white
        addressLabel.alignment = .center
        addressLabel.lineBreakMode = .byTruncatingMiddle
        addressLabel.isSelectable = true
        hintLabel.font = .systemFont(ofSize: 12)
        hintLabel.textColor = NSColor(calibratedWhite: 0.48, alpha: 1)
        hintLabel.alignment = .center

        let addressStack = NSStackView(views: [addressCaption, addressLabel, hintLabel])
        addressStack.orientation = .vertical
        addressStack.spacing = 9
        addressStack.alignment = .centerX
        addressStack.translatesAutoresizingMaskIntoConstraints = false
        qrImageView.wantsLayer = true
        qrImageView.layer?.cornerRadius = 14
        qrImageView.layer?.backgroundColor = NSColor.white.cgColor
        qrImageView.imageScaling = .scaleProportionallyUpOrDown
        qrImageView.translatesAutoresizingMaskIntoConstraints = false
        addressCard.addSubview(qrImageView)
        addressCard.addSubview(addressStack)

        configurePrimaryButton(copyButton, action: #selector(copyAddress))
        configureSecondaryButton(openButton, action: #selector(openDashboard))
        configureSecondaryButton(toggleButton, action: #selector(toggleServer))
        configureSecondaryButton(updateButton, action: #selector(checkForUpdatesManually))
        openButton.isEnabled = false
        copyButton.isEnabled = false

        let mainActions = NSStackView(views: [copyButton, openButton])
        mainActions.orientation = .horizontal
        mainActions.spacing = 10
        mainActions.distribution = .fillEqually

        let footer = NSTextField(wrappingLabelWithString: text("当前为局域网模式。锁屏不会影响同步；Mac 休眠、关机或离开当前网络后将暂时不可访问。", "Local network mode is active. Locking the screen is fine; sleep, shutdown, or leaving this network pauses access."))
        footer.font = .systemFont(ofSize: 11)
        footer.textColor = NSColor(calibratedWhite: 0.42, alpha: 1)
        footer.alignment = .center
        footer.maximumNumberOfLines = 2

        let stack = NSStackView(views: [badge, title, subtitle, statusRow, addressCard, mainActions, toggleButton, versionLabel, updateButton, footer])
        stack.orientation = .vertical
        stack.spacing = 15
        stack.alignment = .centerX
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 42),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -42),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 36),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.bottomAnchor, constant: -28),
            statusDot.widthAnchor.constraint(equalToConstant: 10),
            statusDot.heightAnchor.constraint(equalToConstant: 10),
            addressCard.widthAnchor.constraint(equalTo: stack.widthAnchor),
            addressCard.heightAnchor.constraint(equalToConstant: 176),
            qrImageView.leadingAnchor.constraint(equalTo: addressCard.leadingAnchor, constant: 18),
            qrImageView.centerYAnchor.constraint(equalTo: addressCard.centerYAnchor),
            qrImageView.widthAnchor.constraint(equalToConstant: 136),
            qrImageView.heightAnchor.constraint(equalToConstant: 136),
            addressStack.leadingAnchor.constraint(equalTo: qrImageView.trailingAnchor, constant: 20),
            addressStack.trailingAnchor.constraint(equalTo: addressCard.trailingAnchor, constant: -20),
            addressStack.centerYAnchor.constraint(equalTo: addressCard.centerYAnchor),
            mainActions.widthAnchor.constraint(equalTo: stack.widthAnchor),
            mainActions.heightAnchor.constraint(equalToConstant: 42),
            toggleButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            toggleButton.heightAnchor.constraint(equalToConstant: 38),
            updateButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            updateButton.heightAnchor.constraint(equalToConstant: 32),
        ])
    }

    private func configurePrimaryButton(_ button: NSButton, action: Selector) {
        button.target = self
        button.action = action
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.keyEquivalent = "\r"
    }

    private func configureSecondaryButton(_ button: NSButton, action: Selector) {
        button.target = self
        button.action = action
        button.bezelStyle = .rounded
        button.controlSize = .large
    }

    private func startServer() {
        guard serverProcess?.isRunning != true else { return }
        guard let bundledRoot = Bundle.main.resourceURL?.appendingPathComponent("server"),
              let nodePath = locateNode() else {
            updateStopped(text("未找到 Node.js，请先安装 Node.js 22 或更高版本", "Node.js 22 or newer is required"))
            return
        }
        let resourceRoot = coreStore.activeServerRoot() ?? bundledRoot

        shouldRestart = true
        restartWorkItem?.cancel()
        bestAddressScore = -1
        outputBuffer = ""
        addressLabel.stringValue = text("正在获取局域网地址", "Finding your local network address")
        statusLabel.stringValue = text("正在启动本机服务…", "Starting the local service…")
        statusDot.layer?.backgroundColor = NSColor.systemOrange.cgColor
        toggleButton.title = text("停止服务", "Stop service")

        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [resourceRoot.appendingPathComponent("src/index.mjs").path]
        process.currentDirectoryURL = resourceRoot
        process.standardOutput = pipe
        process.standardError = pipe
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = "8787"
        environment["HOST"] = "0.0.0.0"
        environment["BRIDGE_REQUIRE_PAIRING"] = "0"
        environment["CODEX_BIN"] = "/Applications/ChatGPT.app/Contents/Resources/codex"
        process.environment = environment

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.consumeOutput(text) }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.serverProcess === process else { return }
                pipe.fileHandleForReading.readabilityHandler = nil
                self.serverProcess = nil
                if self.isSwitchingCore {
                    self.isSwitchingCore = false
                    self.shouldRestart = true
                    self.restartAttempts = 0
                    self.startServer()
                    return
                }
                if self.pendingCoreActivation != nil {
                    self.rollbackCoreUpdate()
                    return
                }
                if self.shouldRestart && self.restartAttempts < 5 {
                    self.scheduleRestart()
                } else {
                    self.updateStopped(self.text("服务已停止", "Service stopped"))
                }
            }
        }

        do {
            try process.run()
            serverProcess = process
            if pendingCoreActivation != nil {
                coreStartupWorkItem?.cancel()
                let work = DispatchWorkItem { [weak self, weak process] in
                    guard let self, let process, self.pendingCoreActivation != nil, self.serverProcess === process else { return }
                    process.terminate()
                }
                coreStartupWorkItem = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: work)
            }
        } catch {
            if pendingCoreActivation != nil { rollbackCoreUpdate() }
            else if shouldRestart && restartAttempts < 5 { scheduleRestart() }
            else { updateStopped(text("启动失败：\(error.localizedDescription)", "Could not start: \(error.localizedDescription)")) }
        }
    }

    private func consumeOutput(_ chunk: String) {
        outputBuffer += chunk
        let lines = outputBuffer.components(separatedBy: .newlines)
        outputBuffer = lines.last ?? ""
        for line in lines.dropLast() {
            if line.contains("Codex 掌上任务台已启动") {
                restartAttempts = 0
                statusLabel.stringValue = text("服务运行中 · 任务正在实时同步", "Service online · tasks are syncing live")
                statusDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
                if let activation = pendingCoreActivation {
                    coreStartupWorkItem?.cancel()
                    coreStartupWorkItem = nil
                    pendingCoreActivation = nil
                    availableUpdate = nil
                    updateChecker = GitHubUpdateChecker(currentVersion: coreStore.effectiveVersion())
                    updateButton.isEnabled = true
                    showTemporaryUpdateStatus(text("已热升级到 v\(activation.version)", "Hot-updated to v\(activation.version)"))
                }
            }
            guard let marker = line.range(of: "手机：") else { continue }
            let address = String(line[marker.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            let score = addressScore(address)
            if score > bestAddressScore {
                bestAddressScore = score
                addressLabel.stringValue = address
                qrImageView.image = makeQRCode(address)
                openButton.isEnabled = true
                copyButton.isEnabled = true
            }
        }
    }

    private func addressScore(_ address: String) -> Int {
        if address.contains("192.168.") { return 4 }
        if address.range(of: #"http://172\.(1[6-9]|2\d|3[01])\."#, options: .regularExpression) != nil { return 3 }
        if address.contains("10.") { return 2 }
        if address.contains("169.254.") { return 0 }
        return 1
    }

    private func locateNode() -> String? {
        #if arch(arm64)
        let bundledNode = Bundle.main.resourceURL?.appendingPathComponent("runtime/node-arm64").path
        #else
        let bundledNode = Bundle.main.resourceURL?.appendingPathComponent("runtime/node-x64").path
        #endif
        let candidates = [
            bundledNode,
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ].compactMap { $0 }
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private func stopServer() {
        guard let process = serverProcess, process.isRunning else { return }
        process.terminate()
    }

    private func scheduleRestart() {
        restartAttempts += 1
        let delay = min(pow(2.0, Double(restartAttempts - 1)), 16)
        statusLabel.stringValue = text("服务异常，\(Int(delay)) 秒后自动恢复…", "Service interrupted. Restarting in \(Int(delay))s…")
        statusDot.layer?.backgroundColor = NSColor.systemOrange.cgColor
        let work = DispatchWorkItem { [weak self] in self?.startServer() }
        restartWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func makeQRCode(_ value: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 9, y: 9)) else { return nil }
        let representation = NSCIImageRep(ciImage: output)
        let image = NSImage(size: representation.size)
        image.addRepresentation(representation)
        return image
    }

    private func updateStopped(_ message: String) {
        statusLabel.stringValue = message
        statusDot.layer?.backgroundColor = NSColor.systemRed.cgColor
        toggleButton.title = text("启动服务", "Start service")
        openButton.isEnabled = false
        copyButton.isEnabled = false
    }

    private func configureUpdateChecks() {
        updateChecker = GitHubUpdateChecker(currentVersion: coreStore.effectiveVersion())
        if let cached = updateChecker.cachedUpdate() { showAvailableUpdate(cached, prompt: false) }
        checkForUpdates(force: false)
        updateTimer = Timer.scheduledTimer(withTimeInterval: 6 * 60 * 60, repeats: true) { [weak self] _ in
            self?.checkForUpdates(force: false)
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.checkForUpdates(force: false)
        }
    }

    private func checkForUpdates(force: Bool) {
        if force {
            updateButton.isEnabled = false
            updateButton.title = text("正在检查更新…", "Checking for updates…")
            versionLabel.stringValue = text("当前 v\(coreStore.effectiveVersion()) · 正在获取最新版本", "Current v\(coreStore.effectiveVersion()) · checking latest")
        }
        updateChecker.check(force: force) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.updateButton.isEnabled = true
                switch result {
                case .available(let update):
                    self.showAvailableUpdate(update, prompt: true)
                case .skipped(let cached):
                    if let cached { self.showAvailableUpdate(cached, prompt: false) }
                    else { self.showUpToDateState() }
                case .upToDate:
                    self.availableUpdate = nil
                    self.showUpToDateState()
                case .noRelease:
                    self.availableUpdate = nil
                    self.showNoReleaseState()
                case .failed:
                    if self.availableUpdate == nil { self.showUpdateCheckFailed() }
                }
            }
        }
    }

    private func showAvailableUpdate(_ update: UpdateRelease, prompt: Bool) {
        availableUpdate = update
        let canHotUpdate = update.coreAsset != nil
        versionLabel.stringValue = text(
            "当前 v\(coreStore.effectiveVersion())  →  新版 v\(update.version)",
            "Current v\(coreStore.effectiveVersion())  →  New v\(update.version)"
        )
        updateButton.title = canHotUpdate
            ? text("核心热升级到 v\(update.version)", "Hot-update core to v\(update.version)")
            : text("完整升级到 v\(update.version)", "Full update to v\(update.version)")
        guard prompt else { return }
        let promptKey = "CodexLocalHubLastPromptedUpdateVersion"
        guard UserDefaults.standard.string(forKey: promptKey) != update.version else { return }
        UserDefaults.standard.set(update.version, forKey: promptKey)
        let alert = NSAlert()
        alert.messageText = text("Codex Local Hub 有新版本", "A Codex Local Hub update is available")
        alert.informativeText = canHotUpdate
            ? text("v\(update.version) 已发布。核心更新可以在后台完成，不需要重新安装程序。", "Version \(update.version) is ready. Its core can update in place without reinstalling the app.")
            : text("v\(update.version) 需要更新 Mac 宿主程序，将下载并打开完整安装包。", "Version \(update.version) requires a newer Mac host. The full installer will be downloaded and opened.")
        alert.addButton(withTitle: canHotUpdate ? text("立即热升级", "Update Now") : text("下载完整更新", "Download Full Update"))
        alert.addButton(withTitle: text("稍后", "Later"))
        if alert.runModal() == .alertFirstButtonReturn { applyAvailableUpdate() }
    }

    private func showTemporaryUpdateStatus(_ value: String) {
        updateButton.title = value
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self else { return }
            if let update = self.availableUpdate { self.showAvailableUpdate(update, prompt: false) }
            else { self.showUpToDateState() }
        }
    }

    private func showUpToDateState() {
        let version = coreStore.effectiveVersion()
        versionLabel.stringValue = text("当前 v\(version) · 已是最新正式版", "Current v\(version) · latest stable")
        updateButton.title = text("重新检查更新", "Check again")
        updateButton.isEnabled = true
    }

    private func showUpdateCheckFailed() {
        let version = coreStore.effectiveVersion()
        versionLabel.stringValue = text("当前 v\(version) · 暂时无法获取最新版本", "Current v\(version) · latest version unavailable")
        updateButton.title = text("重试检查更新", "Retry update check")
        updateButton.isEnabled = true
    }

    private func showNoReleaseState() {
        let version = coreStore.effectiveVersion()
        versionLabel.stringValue = text("当前 v\(version) · 暂无已发布的正式版", "Current v\(version) · no stable release published")
        updateButton.title = text("重新检查更新", "Check again")
        updateButton.isEnabled = true
    }

    private func applyAvailableUpdate() {
        guard let update = availableUpdate else {
            checkForUpdates(force: true)
            return
        }
        if let coreAsset = update.coreAsset {
            downloadCoreUpdate(update: update, asset: coreAsset)
        } else {
            downloadInstaller(update: update)
        }
    }

    private func downloadCoreUpdate(update: UpdateRelease, asset: UpdateAsset) {
        updateButton.isEnabled = false
        updateButton.title = text("正在下载核心更新…", "Downloading core update…")
        URLSession.shared.downloadTask(with: asset.url) { [weak self] temporaryURL, _, error in
            guard let self else { return }
            guard error == nil, let temporaryURL else {
                DispatchQueue.main.async {
                    self.updateButton.isEnabled = true
                    self.showTemporaryUpdateStatus(self.text("热升级下载失败", "Core update download failed"))
                }
                return
            }
            do {
                let activation = try self.coreStore.install(archive: temporaryURL, expectedVersion: update.version, expectedSHA256: asset.sha256)
                DispatchQueue.main.async { self.activateCoreUpdate(activation) }
            } catch CoreUpdateError.incompatibleHost {
                DispatchQueue.main.async {
                    self.updateButton.isEnabled = true
                    self.downloadInstaller(update: update)
                }
            } catch {
                DispatchQueue.main.async {
                    self.updateButton.isEnabled = true
                    self.showTemporaryUpdateStatus(self.text("核心校验失败，已取消升级", "Core verification failed. Update cancelled"))
                }
            }
        }.resume()
    }

    private func activateCoreUpdate(_ activation: CoreActivation) {
        pendingCoreActivation = activation
        updateButton.isEnabled = false
        updateButton.title = text("正在切换到 v\(activation.version)…", "Switching to v\(activation.version)…")
        restartAttempts = 0
        if serverProcess?.isRunning == true {
            isSwitchingCore = true
            shouldRestart = false
            stopServer()
        } else {
            shouldRestart = true
            startServer()
        }
    }

    private func rollbackCoreUpdate() {
        guard let activation = pendingCoreActivation else { return }
        coreStore.restore(directoryName: activation.previousDirectoryName)
        pendingCoreActivation = nil
        isSwitchingCore = false
        coreStartupWorkItem?.cancel()
        coreStartupWorkItem = nil
        shouldRestart = true
        restartAttempts = 0
        updateButton.isEnabled = true
        showTemporaryUpdateStatus(text("新核心启动失败，已自动回退", "New core failed to start. Rolled back automatically"))
        startServer()
    }

    private func downloadInstaller(update: UpdateRelease) {
        guard let asset = update.installerAsset else {
            NSWorkspace.shared.open(update.pageURL)
            return
        }
        updateButton.isEnabled = false
        updateButton.title = text("正在下载安装包…", "Downloading installer…")
        URLSession.shared.downloadTask(with: asset.url) { [weak self] temporaryURL, _, error in
            guard let self else { return }
            guard error == nil, let temporaryURL else {
                DispatchQueue.main.async {
                    self.updateButton.isEnabled = true
                    self.showTemporaryUpdateStatus(self.text("下载失败，请稍后重试", "Download failed. Try again later"))
                }
                return
            }
            guard self.coreStore.verify(file: temporaryURL, expectedSHA256: asset.sha256) else {
                DispatchQueue.main.async {
                    self.updateButton.isEnabled = true
                    self.showTemporaryUpdateStatus(self.text("安装包校验失败，已取消下载", "Installer verification failed. Download cancelled"))
                }
                return
            }
            do {
                let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
                var destination = downloads.appendingPathComponent(asset.name)
                if FileManager.default.fileExists(atPath: destination.path) {
                    destination = downloads.appendingPathComponent("Codex-Local-Hub-\(update.version)-\(Int(Date().timeIntervalSince1970)).dmg")
                }
                try FileManager.default.moveItem(at: temporaryURL, to: destination)
                DispatchQueue.main.async {
                    self.updateButton.isEnabled = true
                    self.updateButton.title = self.text("安装包已打开", "Installer opened")
                    NSWorkspace.shared.open(destination)
                }
            } catch {
                DispatchQueue.main.async {
                    self.updateButton.isEnabled = true
                    self.showTemporaryUpdateStatus(self.text("无法保存安装包", "Could not save installer"))
                }
            }
        }.resume()
    }

    @objc private func copyAddress() {
        guard addressLabel.stringValue.hasPrefix("http") else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(addressLabel.stringValue, forType: .string)
        hintLabel.stringValue = text("已复制，在手机浏览器中粘贴打开", "Copied. Paste it into your phone browser")
    }

    @objc private func openDashboard() {
        guard let url = URL(string: addressLabel.stringValue) else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func toggleServer() {
        if serverProcess?.isRunning == true {
            shouldRestart = false
            stopServer()
        } else {
            shouldRestart = true
            startServer()
        }
    }

    @objc private func checkForUpdatesManually() {
        if availableUpdate != nil { applyAvailableUpdate() }
        else { checkForUpdates(force: true) }
    }
}
