Model files for the phone app. NOTHING here is needed today.

1. Display outlets: the camera already checks the red Smile Corner frame by colour (no model file).
   display_detector.tflite is optional and not planned. If one is ever trained, put it here and set
   GUIDE_MODEL_URL: 'models/display_detector.tflite' in config.js.

2. Premium SKUs (Stage 6, after training on your SKU and outlet photos):
   models/premium/manifest.json, pack_detector.tflite, sku_embedder.tflite, references.json
   Then set PREMIUM_MODEL_URL: 'models/premium/manifest.json' in config.js and raise the app version
   (APP_VERSION in config.js and CACHE in sw.js). Until then every photo shows premium "Not checked".
