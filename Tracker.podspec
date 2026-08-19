require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "Tracker"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # iOS 17.0 is the floor and it is not a choice: the vendored frameworks target
  # arm64-apple-ios17.0. s.platforms alone only fails a *clean* install; the incremental
  # case is guarded by the consumer's Podfile post_install gate (carried in example).
  s.platforms    = { :ios => "17.0" }
  s.source       = { :git => "https://github.com/fieldtrack360/react-native-tracker.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.private_header_files = "ios/**/*.h"

  # The five Tracker XCFrameworks, fetched into ios/Frameworks by scripts/fetch-ios-frameworks.js
  # on postinstall and checksum-verified against package.json tracker.ios.checksums.
  # ios/Frameworks ships EMPTY and is filled on the consumer's machine.
  s.vendored_frameworks = "ios/Frameworks/*.xcframework"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    # Our thin bridge is ordinary Swift; the vendored frameworks are Swift 6 with library
    # evolution and interoperate fine from a Swift 5 consumer.
    "SWIFT_VERSION" => "5.0"
  }

  install_modules_dependencies(s)
end
