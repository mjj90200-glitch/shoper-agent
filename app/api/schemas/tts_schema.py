"""文本转语音接口模型。"""

from pydantic import BaseModel, Field


class SpeechSynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=6000)
