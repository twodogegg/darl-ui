import { useEffect, useMemo, useRef } from 'react';
import { ChevronRight, FileCode2, FileImage, FileText, Folder, FolderOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { AgentSkillResource } from './types';

type FileNode = { name: string; path: string; children?: FileNode[] };

function fileIcon(path: string) {
  if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(path)) return FileImage;
  return /\.(md|txt)$/i.test(path) ? FileText : FileCode2;
}

export function SkillFileTree({ paths, selectedPath, onSelect }: { paths: string[]; selectedPath: string; onSelect: (path: string) => void }) {
  const treeRef = useRef<HTMLElement>(null);
  const nodes = useMemo(() => {
    const root: FileNode[] = [];
    for (const path of paths) {
      let siblings = root;
      const parts = path.split('/');
      parts.forEach((name, index) => {
        const directory = index < parts.length - 1;
        let node = siblings.find((item) => item.name === name && Boolean(item.children) === directory);
        if (!node) {
          node = { name, path: parts.slice(0, index + 1).join('/'), ...(directory ? { children: [] } : {}) };
          siblings.push(node);
        }
        if (node.children) siblings = node.children;
      });
    }
    const sort = (items: FileNode[]) => {
      items.sort((a, b) => Number(b.path === 'SKILL.md') - Number(a.path === 'SKILL.md') || Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      items.forEach((item) => { if (item.children) sort(item.children); });
    };
    sort(root);
    return root;
  }, [paths]);
  useEffect(() => {
    let folder = treeRef.current?.querySelector('[aria-current="page"]')?.closest('details');
    while (folder) {
      folder.open = true;
      folder = folder.parentElement?.closest('details');
    }
  }, [selectedPath]);

  const render = (items: FileNode[]) => <ul>{items.map((node) => {
    const Icon = fileIcon(node.path);
    return <li key={`${node.children ? 'folder' : 'file'}:${node.path}`}>{node.children ? <details open>
      <summary title={node.path}><ChevronRight className="darl-agent-skill-folder-chevron" /><Folder className="darl-agent-skill-folder-closed" /><FolderOpen className="darl-agent-skill-folder-open" /><span>{node.name}</span></summary>
      {render(node.children)}
    </details> : <button type="button" title={node.path} aria-current={selectedPath === node.path ? 'page' : undefined} onClick={() => onSelect(node.path)}><Icon /><span>{node.name || '未命名文件'}</span></button>}</li>;
  })}</ul>;
  return <nav ref={treeRef} className="darl-agent-skill-file-tree" aria-label="Skill 文件">{render(nodes)}</nav>;
}

function resolvePath(filePath: string, href: string) {
  if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href)) return null;
  try { return decodeURIComponent(new URL(href, `https://skill.invalid/${filePath}`).pathname.slice(1)); } catch { return null; }
}

export function SkillMarkdown({ content, filePath, resources, onSelect }: { content: string; filePath: string; resources: AgentSkillResource[]; onSelect: (path: string) => void }) {
  return <div className="darl-agent-markdown darl-agent-skill-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
    a: ({ href, children }) => {
      const path = href ? resolvePath(filePath, href) : null;
      const local = path === 'SKILL.md' || resources.some((resource) => resource.path === path);
      return <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer" onClick={local ? (event) => { event.preventDefault(); onSelect(path!); } : undefined}>{children}</a>;
    },
    img: ({ src, alt }) => {
      const path = typeof src === 'string' ? resolvePath(filePath, src) : null;
      const resource = resources.find((item) => item.path === path);
      const format = path && /\.(png|jpe?g|webp|gif|avif)$/i.exec(path)?.[1].toLowerCase();
      const source = resource?.encoding === 'base64' && format ? `data:image/${format === 'jpg' ? 'jpeg' : format};base64,${resource.content}` : src;
      return <img src={source} alt={alt || ''} loading="lazy" />;
    },
    table: ({ children }) => <div className="darl-agent-skill-markdown-table"><table>{children}</table></div>,
    code: ({ children, className }) => <code className={className || 'darl-agent-inline-code'}>{children}</code>,
  }}>{content}</ReactMarkdown></div>;
}
