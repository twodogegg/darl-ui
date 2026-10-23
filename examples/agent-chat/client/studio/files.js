export async function parseSource(file) {
  const extension = file.name.split('.').pop().toLowerCase()
  if (!['txt', 'md', 'docx', 'xlsx'].includes(extension))
    throw new Error('请选择 TXT、MD、DOCX 或 XLSX 原始素材文件')
  if (file.size > 15 * 1024 * 1024) throw new Error('原始素材文件不能超过 15 MB')
  let text
  try {
    if (extension === 'docx') {
      const mammoth = await import('mammoth/mammoth.browser')
      text = (
        await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
      ).value
    } else if (extension === 'xlsx') {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer())
      text = book.SheetNames.map(
        (name) => `${name}\n${XLSX.utils.sheet_to_csv(book.Sheets[name])}`,
      ).join('\n\n')
    } else text = await file.text()
  } catch {
    throw new Error('原始素材文件解析失败，请确认文件内容与扩展名匹配后重试')
  }
  if (!text.trim()) throw new Error('文件中没有可读取的文本')
  if (text.length > 100000) throw new Error('原始素材内容不能超过 100000 字')
  return text
}

// Validate media locally, then persist it through the existing file service.
export function readMedia(file, kind = 'image') {
  if (!file.type.startsWith(`${kind}/`))
    return Promise.reject(
      new Error(
        `请选择有效的${{ image: '图片', audio: '音频', video: '视频' }[kind]}文件`,
      ),
    )
  if (file.size > 50 * 1024 * 1024)
    return Promise.reject(new Error('本地预览文件不能超过 50 MB'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择'))
    reader.onload = () => {
      const element =
        kind === 'image' ? new Image() : document.createElement(kind)
      const clean = () => {
        element.onload = element.onerror = element.onloadedmetadata = null
        if (kind !== 'image') {
          element.removeAttribute('src')
          element.load()
        }
      }
      let uploading = false
      const loaded = async () => {
        if (uploading) return
        uploading = true
        clean()
        try {
          const form = new FormData(); form.set('file', file)
          const response = await fetch('/api/files', { method: 'POST', body: form })
          const saved = await response.json()
          if (!response.ok) throw new Error(saved.error || '上传失败')
          resolve({
          id: crypto.randomUUID(),
          name: file.name,
          url: `/api/files/${saved.fileId}`,
          fileId: saved.fileId,
          kind,
        })
        } catch (reason) { reject(reason) }
      }
      element.onerror = () => {
        clean()
        reject(new Error('文件无法预览，可能已损坏或浏览器不支持此格式'))
      }
      if (kind === 'image') element.onload = loaded
      else {
        element.preload = 'metadata'
        element.onloadedmetadata = loaded
      }
      element.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export function download(url, name) {
  if (!url) return false
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  return true
}
