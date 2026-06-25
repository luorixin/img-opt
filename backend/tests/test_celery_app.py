from img_cleaner_backend import celery_app


def test_worker_process_does_not_preload_ai_model_by_default(monkeypatch):
    """默认 Celery 子进程不预载 AI 模型，降低空闲 worker 的内存和启动 CPU 峰值。"""
    from img_cleaner_backend import ai_engines

    calls = []
    monkeypatch.delenv("AI_PRELOAD_MODELS", raising=False)
    monkeypatch.delenv("WORKER_AI_PRELOAD_MODELS", raising=False)
    monkeypatch.setattr(ai_engines, "_get_onnx_session", lambda: calls.append("loaded"))

    celery_app.pre_warm_models_in_process(sender=None)

    assert calls == []


def test_worker_process_preloads_ai_model_when_enabled(monkeypatch):
    """需要牺牲空闲内存换取首个任务低延迟时，Celery 仍可显式开启模型预载。"""
    from img_cleaner_backend import ai_engines

    calls = []
    monkeypatch.setenv("WORKER_AI_PRELOAD_MODELS", "true")
    monkeypatch.setattr(ai_engines, "_get_onnx_session", lambda: calls.append("loaded"))

    celery_app.pre_warm_models_in_process(sender=None)

    assert calls == ["loaded"]


def test_worker_specific_preload_flag_overrides_legacy_shared_flag(monkeypatch):
    """Worker 专用开关应优先于旧共享开关，便于只预热 API 或只预热 Worker。"""
    from img_cleaner_backend import ai_engines

    calls = []
    monkeypatch.setenv("AI_PRELOAD_MODELS", "true")
    monkeypatch.setenv("WORKER_AI_PRELOAD_MODELS", "false")
    monkeypatch.setattr(ai_engines, "_get_onnx_session", lambda: calls.append("loaded"))

    celery_app.pre_warm_models_in_process(sender=None)

    assert calls == []
