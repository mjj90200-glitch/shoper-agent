"""问数结论语音合成接口模型。"""

from pydantic import BaseModel, Field


class TTSSynthesizeRequest(BaseModel):
    """仅接收已经生成的简短业务结论，不接收流程节点或完整表格。"""

    text: str = Field(min_length=2, max_length=600)
