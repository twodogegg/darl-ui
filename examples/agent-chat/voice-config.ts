export interface VoiceSettings {
  enabled: boolean;
  ttsModel: 's2.1-pro-free' | 's2.1-pro' | 's2-pro';
  voiceId: string;
  voiceName: string;
  speed: number;
}

export const defaultVoiceSettings: VoiceSettings = { enabled: false, ttsModel: 's2.1-pro-free', voiceId: '', voiceName: '', speed: 1 };

/** Fish catalog tag values; labels are presentation only. */
export const voiceCatalogFilters = {
  defaultLanguage: 'zh',
  languages: [
    { value: '', label: '全部语言' }, { value: 'zh', label: '中文' }, { value: 'en', label: '英语' },
    { value: 'de', label: '德语' }, { value: 'ja', label: '日语' }, { value: 'fr', label: '法语' },
    { value: 'es', label: '西班牙语' }, { value: 'ko', label: '韩语' }, { value: 'ar', label: '阿拉伯语' },
    { value: 'ru', label: '俄语' }, { value: 'pt', label: '葡萄牙语' },
  ],
  sorts: [{ value: 'score', label: '推荐排序' }, { value: 'task_count', label: '最多使用' }, { value: 'created_at', label: '最新音色' }],
  tagGroups: [
    { label: '性别', options: [{ value: 'male', label: '男声' }, { value: 'female', label: '女声' }, { value: 'neutral', label: '中性' }] },
    { label: '年龄', options: [{ value: 'young', label: '年轻' }, { value: 'middle-aged', label: '中年' }, { value: 'old', label: '年长' }] },
    { label: '用途', options: [{ value: 'conversational', label: '对话' }, { value: 'narration', label: '旁白' }, { value: 'character-voice', label: '角色配音' }, { value: 'social-media', label: '社交媒体' }, { value: 'educational', label: '教育' }, { value: 'advertisement', label: '广告' }, { value: 'entertainment', label: '娱乐' }] },
    { label: '音色特点', options: [{ value: 'deep', label: '低沉' }, { value: 'low', label: '低音' }, { value: 'medium', label: '中音' }, { value: 'high', label: '高音' }, { value: 'soft', label: '柔和' }, { value: 'bright', label: '明亮' }, { value: 'clear', label: '清晰' }, { value: 'warm', label: '温暖' }, { value: 'energetic', label: '活力' }, { value: 'professional', label: '专业' }] },
  ],
};
