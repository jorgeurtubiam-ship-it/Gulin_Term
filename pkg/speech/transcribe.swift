import Foundation
import Speech
import AVFoundation

guard CommandLine.arguments.count > 1 else {
    print(jsonError("Usage: transcribe <audio_file_path>"))
    exit(1)
}

let audioPath = CommandLine.arguments[1]
let audioURL = URL(fileURLWithPath: audioPath)

guard FileManager.default.fileExists(atPath: audioPath) else {
    print(jsonError("Audio file not found: \(audioPath)"))
    exit(1)
}

let locale = Locale(identifier: "es-ES")
guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
    print(jsonError("Speech recognizer not available for locale es-ES"))
    exit(1)
}

let request = SFSpeechURLRecognitionRequest(url: audioURL)
request.shouldReportPartialResults = false
if #available(macOS 10.15, *) {
    request.requiresOnDeviceRecognition = false
}

let semaphore = DispatchSemaphore(value: 0)
var resultText = ""
var errorMessage: String? = nil

recognizer.recognitionTask(with: request) { result, error in
    if let error = error {
        errorMessage = error.localizedDescription
        semaphore.signal()
        return
    }
    
    if let result = result {
        if result.isFinal {
            resultText = result.bestTranscription.formattedString
            semaphore.signal()
        }
    }
}

let timeout = DispatchTime.now() + .seconds(10)
if semaphore.wait(timeout: timeout) == .timedOut {
    if resultText.isEmpty {
        print(jsonError("Recognition timed out"))
        exit(1)
    }
}

if let err = errorMessage, resultText.isEmpty {
    print(jsonError(err))
    exit(1)
}

let response: [String: Any] = [
    "success": true,
    "transcript": resultText
]

if let jsonData = try? JSONSerialization.data(withJSONObject: response, options: []),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
} else {
    print("{\"success\":true,\"transcript\":\"\(resultText)\"}")
}

func jsonError(_ msg: String) -> String {
    let cleanMsg = msg.replacingOccurrences(of: "\"", with: "\\\"")
    return "{\"success\":false,\"error\":\"\(cleanMsg)\"}"
}
