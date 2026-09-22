import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins

@main
final class CodexBridgeApp: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private static var retainedDelegate: CodexBridgeApp?

    static func main() {
        let delegate = CodexBridgeApp()
        retainedDelegate = delegate
        let application = NSApplication.shared
        application.delegate = delegate
        application.run()
    }

    private var window: NSWindow!
    private var serverProcess: Process?
    private var outputBuffer = ""
    private var bestAddressScore = -1
    private var pairingAddress = ""
    private var shouldRestart = true
    private var restartAttempts = 0
    private var restartWorkItem: DispatchWorkItem?

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

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        startServer()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        shouldRestart = false
        restartWorkItem?.cancel()
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

        let subtitle = NSTextField(wrappingLabelWithString: text("在同一 Wi-Fi 下扫描二维码，即可查看 Codex 任务、继续对话并接收图片结果。访问口令由程序自动管理。", "Scan the QR code on the same Wi-Fi to monitor Codex tasks, continue conversations, and review visual results. Access credentials are managed automatically."))
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

        let stack = NSStackView(views: [badge, title, subtitle, statusRow, addressCard, mainActions, toggleButton, footer])
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
        guard let resourceRoot = Bundle.main.resourceURL?.appendingPathComponent("server"),
              let nodePath = locateNode() else {
            updateStopped(text("未找到 Node.js，请先安装 Node.js 22 或更高版本", "Node.js 22 or newer is required"))
            return
        }

        shouldRestart = true
        restartWorkItem?.cancel()
        bestAddressScore = -1
        pairingAddress = ""
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
        } catch {
            if shouldRestart && restartAttempts < 5 { scheduleRestart() }
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
            }
            if let pairingMarker = line.range(of: "配对：") {
                pairingAddress = String(line[pairingMarker.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                qrImageView.image = makeQRCode(pairingAddress)
                continue
            }
            guard let marker = line.range(of: "手机：") else { continue }
            let address = String(line[marker.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            let score = addressScore(address)
            if score > bestAddressScore {
                bestAddressScore = score
                addressLabel.stringValue = address
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

    @objc private func copyAddress() {
        guard addressLabel.stringValue.hasPrefix("http") else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingAddress.isEmpty ? addressLabel.stringValue : pairingAddress, forType: .string)
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
}
