package com.fieldtrack360.tracker

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class TrackerPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      TrackerModule.NAME -> TrackerModule(reactContext)
      TrackerSyncModule.NAME -> TrackerSyncModule(reactContext)
      else -> null
    }

  // Fabric map components. Registered here so autolinking finds them on the New Architecture.
  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = listOf(TrackerMapViewManager(), LiveTrackMapViewManager())

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      TrackerModule.NAME to ReactModuleInfo(
        name = TrackerModule.NAME,
        className = TrackerModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      ),
      TrackerSyncModule.NAME to ReactModuleInfo(
        name = TrackerSyncModule.NAME,
        className = TrackerSyncModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }
}
