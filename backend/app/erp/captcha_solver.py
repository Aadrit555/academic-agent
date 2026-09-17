import os
import io
import logging
from typing import Optional
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
IDX2CHAR = {i + 1: c for i, c in enumerate(CHARS)}

TARGET_W = 120
TARGET_H = 25

_session = None

def get_captcha_model_path() -> str:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(base_dir, "models", "captcha_crnn.onnx")
    if os.path.exists(model_path):
        return model_path
    # Fallback to _references if needed
    ref_path = os.path.abspath(os.path.join(base_dir, "..", "..", "..", "_references", "Srmap-Api", "deprecated", "python", "captcha_crnn.onnx"))
    if os.path.exists(ref_path):
        return ref_path
    return model_path

def get_inference_session():
    global _session
    if _session is not None:
        return _session
    
    try:
        import onnxruntime as ort
        model_path = get_captcha_model_path()
        if not os.path.exists(model_path):
            logger.warning(f"Captcha model not found at {model_path}")
            return None
        
        # Load ONNX session with CPU provider
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        _session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
        logger.info(f"Loaded ONNX Captcha CRNN model from {model_path}")
        return _session
    except Exception as e:
        logger.error(f"Failed to load ONNX captcha session: {e}")
        return None

def solve_captcha(image_bytes: bytes) -> str:
    """
    Solves SRM AP eVarsity / Student Corner alphanumeric captchas using
    an in-memory CRNN-CTC model in ~2-5ms without any external service.
    """
    if not image_bytes:
        return ""
        
    session = get_inference_session()
    if session is None:
        logger.error("ONNX Captcha model is not available")
        return ""

    try:
        img = Image.open(io.BytesIO(image_bytes))
        
        # Crop to 120x25 if portal returned larger image (e.g. 220x30 with padding)
        if img.width > TARGET_W or img.height > TARGET_H:
            img = img.crop((0, 0, TARGET_W, TARGET_H))
            
        # Convert to single-channel Grayscale
        img_gray = img.convert("L")
        
        # Resize to (120, 32) expected by CRNN
        img_resized = img_gray.resize((120, 32), Image.BILINEAR)
        
        # Normalize: (pixel / 255.0 - 0.5) / 0.5 -> [-1.0, 1.0]
        arr = (np.array(img_resized, dtype=np.float32) / 255.0 - 0.5) / 0.5
        tensor = arr[np.newaxis, np.newaxis, :, :] # shape (1, 1, 32, 120)
        
        # Run inference
        logits = session.run(None, {"input": tensor})[0]
        
        # CTC Greedy Decode: collapse repeated characters and remove blanks (0)
        preds = logits.argmax(2).T
        predicted = ""
        prev = 0
        for c in preds[0]:
            if c != prev and c != 0:
                predicted += IDX2CHAR.get(c, "")
            prev = c
            
        return predicted.strip().upper()
    except Exception as e:
        logger.error(f"Error during captcha inference: {e}")
        return ""

