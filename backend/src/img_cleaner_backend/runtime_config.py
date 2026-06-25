"""
运行时配置辅助模块。

该模块集中处理环境变量的布尔值和整数解析，避免各个入口模块
重复写字符串判断逻辑，并让 Docker 资源调优相关开关保持一致。
"""
from __future__ import annotations

import os


TRUE_VALUES = {"1", "true", "yes", "on"}


def env_flag(name: str, default: bool = False) -> bool:
    """
    读取布尔型环境变量。

    参数:
        name: 环境变量名称。
        default: 未设置或为空字符串时使用的默认值。

    返回:
        bool: 当变量值为 1/true/yes/on 时返回 True，否则返回 False。
    """
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in TRUE_VALUES


def env_flag_with_legacy(name: str, legacy_name: str, default: bool = False) -> bool:
    """
    读取带旧环境变量兼容的布尔开关。

    参数:
        name: 新的专用环境变量名称，优先级最高。
        legacy_name: 旧的共享环境变量名称，仅当新变量未设置时使用。
        default: 两者都未设置时使用的默认值。

    返回:
        bool: 解析后的开关值。
    """
    if os.getenv(name) is not None:
        return env_flag(name, default=default)
    return env_flag(legacy_name, default=default)


def env_int_at_least(name: str, default: int, minimum: int = 1) -> int:
    """
    读取有下限保护的整数环境变量。

    ONNX Runtime 线程数不能小于 1；如果用户传入非法值，回退到默认值，
    防止容器启动时因为配置错误直接崩溃。
    """
    raw_value = os.getenv(name)
    if raw_value is None or raw_value.strip() == "":
        return default
    try:
        parsed = int(raw_value)
    except ValueError:
        return default
    return max(minimum, parsed)
