import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FilePlus2, FileText, FolderOpen, HardDrive, LayoutGrid, Link2, LoaderCircle, Maximize2, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X, ZoomIn, ZoomOut, Eye, Keyboard, PanelLeftClose } from 'lucide-react';
import { openPdf, renderPage, applyRedSheet } from './lib/pdf';
import { listSheets, putSheet, deleteSheet, type SheetRecord } from './lib/storage';

type PdfDocument = Awaited<ReturnType<typeof openPdf>>;
const SUBJECTS = ['未分類', '英語', '国語', '数学', '理科', '社会', 'その他'];
const MAX_BYTES = 50 * 1024 * 1024;
const dateText = (time: number) => new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric' }).format(time);
const sizeText = (size: number) => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

function Logo({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'small' : ''}`}><span className="brand-icon"><FileText size={23} strokeWidth={1.7} /><i /></span><span>赤シート<span className="brand-caption">AKASHEET</span></span></div>;
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0]; const last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="閉じる" onClick={close}><X size={21} /></button></div>{children}</div></div>;
}

function SheetThumbnail({ sheet }: { sheet: SheetRecord }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false; let doc: PdfDocument | null = null;
    void (async () => {
      doc = await openPdf(new Uint8Array(await sheet.blob.arrayBuffer()));
      if (disposed) return;
      const page = await renderPage(doc, 1, 330);
      if (!disposed && ref.current) { ref.current.width = page.width; ref.current.height = page.height; ref.current.getContext('2d')?.drawImage(page, 0, 0); }
    })().catch(() => {}).finally(() => { void doc?.loadingTask.destroy(); });
    return () => { disposed = true; };
  }, [sheet.blob]);
  return <div className="thumbnail"><canvas ref={ref} aria-hidden="true" /><span className="thumb-sheet" /><span className="pdf-label">PDF</span></div>;
}

function HeroPreview({ onTry }: { onTry: () => void }) {
  const [covered, setCovered] = useState(true);
  return <div className="hero-art"><span className="art-star star-a">✳</span><span className="art-star star-b">＋</span><div className="art-paper"><span className="paper-kicker">LET’S LEARN SOMETHING NEW</span><h3>きょうの、ひとつ。</h3><div className="art-rule" /><p>植物が光のエネルギーを使って、</p><p>養分をつくるはたらきは？</p><div className={`art-answer ${covered ? 'covered' : ''}`}><span>光合成</span></div><div className="art-lines"><i /><i /><i /></div><span className="paper-number">01 / 03</span></div><button className={`art-toggle ${covered ? 'active' : ''}`} onClick={() => setCovered(!covered)} aria-label="プレビューの赤シートを切り替える"><span className="mini-switch"><i /></span> 赤シート {covered ? 'ON' : 'OFF'}<span className="tap-hint">タップしてみよう</span></button><button className="art-caption" onClick={onTry}>サンプルPDFで体験する <ArrowRight size={15} /></button></div>;
}

function App() {
  const [sheets, setSheets] = useState<SheetRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('すべて');
  const [sort, setSort] = useState('recent');
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [modal, setModal] = useState<'help' | 'url' | 'storage' | null>(null);
  const [editing, setEditing] = useState<SheetRecord | null>(null);
  const [deleting, setDeleting] = useState<SheetRecord | null>(null);
  const [url, setUrl] = useState('');
  const [active, setActive] = useState<SheetRecord | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissModal = useCallback(() => setModal(null), []);
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  useEffect(() => { void listSheets().then(setSheets).catch(() => notify('端末保存を利用できません。ブラウザのストレージ設定を確認してください。', true)).finally(() => setReady(true)); }, [notify]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 6500); return () => clearTimeout(timer); }, [notice]);

  const persist = useCallback(async (sheet: SheetRecord) => {
    await putSheet(sheet);
    setSheets(all => [...all.filter(s => s.id !== sheet.id), sheet]);
  }, []);

  async function importFiles(files: File[] | FileList) {
    if (busy) return;
    const selected = Array.from(files); if (!selected.length) return;
    setBusy('PDFを読み込んでいます…');
    let imported = 0;
    const errors: string[] = [];
    let first: SheetRecord | null = null;
    try {
      for (const file of selected) {
        let doc: PdfDocument | null = null;
        try {
          if (file.size > MAX_BYTES) throw new Error('PDFは1ファイル50 MBまでです。');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('PDF形式のファイルを選んでください。');
          doc = await openPdf(bytes);
          const record: SheetRecord = { id: crypto.randomUUID(), name: file.name.replace(/\.pdf$/i, ''), blob: file, createdAt: Date.now(), lastOpened: Date.now(), page: 1, totalPages: doc.numPages, subject: '未分類', bookmarks: [], sensitivity: 65 };
          await persist(record); imported++; if (!first) first = record;
        } catch (error) {
          const message = error instanceof Error ? error.message : '読み込めませんでした。';
          errors.push(`${file.name}: ${/password/i.test(message) ? 'パスワードを解除したPDFを保存してから読み込んでください。' : message}`);
        } finally { await doc?.loadingTask.destroy(); }
      }
      if (errors.length) notify(`${imported ? `${imported}件を追加。 ` : ''}${errors.join(' / ')}`, true);
      else { notify(`${imported}件のPDFを端末に保存しました`); if (selected.length === 1 && first) setActive(first); }
    } finally { setBusy(''); if (inputRef.current) inputRef.current.value = ''; }
  }

  async function trySample() {
    const existing = sheets.find(s => s.id === 'akasheet-demo-v1');
    if (existing) { setActive(existing); return; }
    if (busy) return;
    setBusy('サンプルを準備しています…');
    let doc: PdfDocument | null = null;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sample.pdf`); if (!response.ok) throw new Error();
      const blob = await response.blob(); doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
      const sample: SheetRecord = { id: 'akasheet-demo-v1', name: 'サンプル｜理科と英語の暗記シート', blob, createdAt: Date.now(), lastOpened: Date.now(), page: 1, totalPages: doc.numPages, subject: '理科', bookmarks: [], sensitivity: 65 };
      await persist(sample); setActive(sample);
    } catch { notify('サンプルを読み込めませんでした。通信状況と端末の空き容量を確認してください。', true); }
    finally { await doc?.loadingTask.destroy(); setBusy(''); }
  }

  async function importUrl(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    let parsed: URL;
    try { parsed = new URL(url); if (parsed.protocol !== 'https:') throw new Error(); }
    catch { notify('https:// から始まるPDFのURLを入力してください。', true); return; }
    setBusy('URLからPDFを取得しています…');
    try {
      const response = await fetch(parsed.toString(), { signal: AbortSignal.timeout(30000), credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error();
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength > MAX_BYTES) throw new Error('size');
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      const chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('size'); } chunks.push(value); }
      const file = new File(chunks, decodeURIComponent(parsed.pathname.split('/').pop() || 'PDF教材.pdf'), { type: 'application/pdf' });
      setBusy(''); setModal(null); setUrl(''); await importFiles([file]);
    } catch (error) { notify(error instanceof Error && error.message === 'size' ? 'PDFは50 MBまでです。' : 'このURLから直接取得できません。配信元でPDFを端末に保存し、「PDFを追加」から選んでください。', true); }
    finally { setBusy(''); }
  }

  function drop(e: DragEvent) { e.preventDefault(); setDragging(false); void importFiles(e.dataTransfer.files); }
  const totalBytes = sheets.reduce((n, s) => n + s.blob.size, 0);
  const visible = sheets.filter(s => (!bookmarksOnly || s.bookmarks.length > 0) && (subject === 'すべて' || s.subject === subject) && s.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ja') : sort === 'created' ? b.createdAt - a.createdAt : b.lastOpened - a.lastOpened);

  return <>
    <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="visually-hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) void importFiles(e.target.files); }} aria-label="PDFファイルを選択" />
    {active ? <Viewer sheet={active} save={persist} close={() => setActive(null)} notify={notify} /> : <div className="app-shell">
      <aside className="sidebar"><Logo /><div className="sidebar-section-label">YOUR WORKSPACE</div><nav aria-label="メインメニュー"><button className={!bookmarksOnly ? 'nav-item selected' : 'nav-item'} onClick={() => setBookmarksOnly(false)}><LayoutGrid size={19} /> マイライブラリ <span>{sheets.length}</span></button><button className={bookmarksOnly ? 'nav-item selected' : 'nav-item'} onClick={() => setBookmarksOnly(true)}><Bookmark size={19} /> しおりのある教材 <span>{sheets.filter(s => s.bookmarks.length).length}</span></button></nav><button className="sidebar-add" onClick={() => inputRef.current?.click()} disabled={!!busy}><Plus size={18} /> PDFを追加</button><div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><ShieldCheck size={20} /></span><strong>教材は、あなたの端末に。</strong><p>取り込んだPDFはこのブラウザに保存されます。</p><button onClick={() => setModal('storage')}>保存状況を見る <ArrowRight size={13} /></button></div><button className="sidebar-help" onClick={() => setModal('help')}><CircleHelp size={18} /> 使い方・よくある質問 <ArrowRight size={15} /></button><p className="sidebar-footnote">毎日の「覚えた」を、少しずつ。</p></div></aside>
      <div className="main-shell"><header className="topbar"><div className="mobile-brand"><Logo small /></div><div className="breadcrumb"><FolderOpen size={16} /><span>ワークスペース</span><ChevronRight size={13} /><strong>{bookmarksOnly ? 'しおりのある教材' : 'マイライブラリ'}</strong></div><div className="topbar-status"><span className="status-dot" /> ログイン不要 <span className="topbar-divider" /><HardDrive size={15} /> 端末に保存</div><button className="icon-button mobile-help" aria-label="使い方" onClick={() => setModal('help')}><CircleHelp size={20} /></button></header>
      <main className="library-main"><section className="hero"><div className="hero-copy"><div className="eyebrow"><span /> STUDY AT YOUR OWN PACE</div><h1>いつものPDFを、<br /><span>覚える時間に。</span></h1><p>学校のプリントも、自分のまとめも。<br />赤字を隠して、確かめて。あなたのペースで覚えよう。</p><button className="text-link" onClick={() => setModal('help')}>はじめての方へ <ArrowUpRightIcon /></button></div><HeroPreview onTry={() => void trySample()} /></section>
      <section className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={drop} aria-label="PDFの取り込み"><div className="upload-symbol"><FilePlus2 size={25} strokeWidth={1.5} /><span><Plus size={12} /></span></div><div className="upload-copy"><h2>PDFをここにドロップ</h2><p>ロイロノートなどから保存した教材を、そのまま。</p><span>PDF形式・1ファイル50 MBまで・複数選択OK</span></div><div className="upload-actions"><button className="button primary" onClick={() => inputRef.current?.click()} disabled={!!busy}><Upload size={17} /> PDFを選ぶ</button><button className="url-button" onClick={() => setModal('url')}><Link2 size={14} /> URLから読み込む</button></div></section>
      <section className="library-section"><div className="section-heading"><div><h2>{bookmarksOnly ? 'しおりのある教材' : 'マイライブラリ'} <span>{visible.length}</span></h2><p>続きから、いつでも。</p></div><div className="library-tools"><label className="search-field"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="教材を検索" aria-label="教材を検索" />{query && <button onClick={() => setQuery('')} aria-label="検索をクリア"><X size={14} /></button>}</label><label className="sort-field"><select value={sort} onChange={e => setSort(e.target.value)} aria-label="並び順"><option value="recent">最近開いた順</option><option value="created">追加した順</option><option value="name">名前順</option></select><ChevronDown size={14} /></label></div></div><div className="subject-tabs" aria-label="教科で絞り込む">{['すべて', ...SUBJECTS.filter(s => sheets.some(item => item.subject === s))].map(s => <button key={s} onClick={() => setSubject(s)} aria-pressed={subject === s} className={subject === s ? 'active' : ''}>{s}</button>)}</div>
      {!ready ? <div className="empty-state"><LoaderCircle className="spin" /><p>ライブラリを読み込んでいます…</p></div> : visible.length ? <div className="sheet-grid">{visible.map(sheet => <article className="sheet-card" key={sheet.id}><button className="card-open" onClick={() => setActive(sheet)} aria-label={`${sheet.name}を開く`}><SheetThumbnail sheet={sheet} /><div className="card-content"><div className="card-meta"><span className={`subject-chip subject-${SUBJECTS.indexOf(sheet.subject)}`}>{sheet.subject}</span><span>{sheet.totalPages}ページ</span></div><h3>{sheet.name}</h3><div className="card-footer"><span>{dateText(sheet.lastOpened)}に開きました</span><span>{sheet.page} / {sheet.totalPages} <ArrowRight size={14} /></span></div></div></button><button className="card-menu icon-button" onClick={() => setEditing(sheet)} aria-label={`${sheet.name}の設定`}><MoreHorizontal size={18} /></button>{sheet.bookmarks.length > 0 && <span className="bookmark-badge"><Bookmark size={12} fill="currentColor" /> {sheet.bookmarks.length}</span>}</article>)}<button className="add-card" onClick={() => inputRef.current?.click()}><span><Plus size={24} /></span><strong>新しい教材を追加</strong><small>次の「覚えた」をはじめよう</small></button></div> : <div className="empty-state">{sheets.length ? <><Search size={30} /><h3>教材が見つかりませんでした</h3><p>検索する言葉や教科を変えてみてください。</p><button className="text-link" onClick={() => { setQuery(''); setSubject('すべて'); setBookmarksOnly(false); }}>絞り込みをリセット <ArrowRight size={15} /></button></> : <><span className="empty-icon"><BookOpen size={30} strokeWidth={1.4} /></span><h3>最初の1枚から、はじめよう。</h3><p>PDFを追加すると、ここに教材が並びます。</p><button className="sample-button" onClick={() => void trySample()} disabled={!!busy}><Sparkles size={16} /> サンプルPDFで試す <ArrowRight size={16} /></button></>}</div>}</section>
      <section className="how-strip" aria-label="3ステップの使い方"><div><span>01</span><p><strong>PDFを取り込む</strong>端末に保存した教材を選択</p></div><ChevronRight size={17} /><div><span>02</span><p><strong>赤シートをON</strong>赤い答えを隠して考える</p></div><ChevronRight size={17} /><div><span>03</span><p><strong>答えを確かめる</strong>OFFにして、もう一度</p></div></section><footer className="main-footer"><span>赤シート <i>—</i> 小さな積み重ねを、力に。</span><button onClick={() => setModal('help')}>使い方とプライバシー <ArrowRight size={13} /></button></footer></main></div></div>}
    {modal === 'help' && <Modal title="赤シートの使い方" close={dismissModal}><div className="help-content"><p className="modal-lead">いつもの教材で、隠す → 考える → 確かめる。</p><ol className="help-steps"><li><strong>教材のPDFを端末に保存</strong><p>ロイロノート・スクールなどで教材を開き、「共有」「書き出す」などからPDFを「ファイル」や「ダウンロード」に保存します。操作名は配信サービス・端末で異なります。</p></li><li><strong>「PDFを選ぶ」から取り込む</strong><p>保存したPDFを選択。iPhone・iPadでも「ファイル」から読み込めます。学校アカウントとの直接連携はありません。</p></li><li><strong>赤シートを切り替えて暗記</strong><p>ONで赤い文字を隠し、OFFで答えを表示。「押して答えを見る」は、押している間だけ答えを表示します。赤字が残る場合は「調整」で感度を上げてください。</p></li></ol><div className="info-box"><Keyboard size={19} /><p><strong>パソコンのショートカット</strong><br />Space：赤シート切り替え　← →：ページ移動<br />B：しおり　Esc：ライブラリに戻る</p></div><h3>保存とプライバシー</h3><p>PDF・しおり・読んだページは、この端末のこのブラウザだけに保存されます。アプリから教材をサーバーにアップロードすることはありません。ブラウザのデータ削除で教材も消えるため、元のPDFは保管してください。共有端末では使用後にライブラリから教材を削除してください。</p><h3>うまく隠れないとき</h3><p>黒字の答えや、赤以外の色は隠れません。図や写真の赤い部分も隠れます。PDFの色・画質によっては完全に隠れない場合があるため、学習前に確認してください。教材の取り扱いは学校・配信元のルールに従ってください。</p><p className="muted">このアプリは、ロイロノート・スクールの公式アプリではありません。</p></div><button className="button primary full" onClick={dismissModal}>わかりました <Check size={17} /></button></Modal>}
    {modal === 'url' && <Modal title="URLからPDFを読み込む" close={dismissModal}><form onSubmit={e => void importUrl(e)}><p className="modal-lead">公開されたPDFの直接リンクを入力してください。</p><label className="form-label">PDFのURL<input autoFocus type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/sheet.pdf" required /></label><div className="info-box"><CircleHelp size={20} /><p>ログインが必要な学校サービスや、外部からの読み込みを制限したURLは取得できません。その場合は、PDFを端末に保存してから追加してください。</p></div><button className="button primary full" type="submit" disabled={!!busy || !url}>{busy ? <LoaderCircle className="spin" size={18} /> : <Link2 size={17} />} 読み込む</button></form></Modal>}
    {modal === 'storage' && <Modal title="この端末の保存状況" close={dismissModal}><div className="storage-stats"><div><strong>{sheets.length}<small>冊</small></strong><span>保存した教材</span></div><div><strong>{sizeText(totalBytes)}</strong><span>PDFの使用容量</span></div></div><div className="info-box"><ShieldCheck size={22} /><p>教材はこのブラウザ内に保存されています。他の端末やブラウザとは同期されません。元のPDFはお手元にも残してください。</p></div><p className="modal-lead">教材の削除・名前・教科の変更は、各教材の「…」からできます。</p></Modal>}
    {editing && <Modal title="教材の設定" close={() => setEditing(null)}><form onSubmit={e => { e.preventDefault(); const updated = { ...editing, name: editing.name.trim() || '名称未設定' }; void persist(updated).then(() => { setEditing(null); notify('教材の設定を保存しました'); }).catch(() => notify('設定を保存できませんでした。', true)); }}><label className="form-label">教材名<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} maxLength={140} required /></label><label className="form-label">教科<select value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })}>{SUBJECTS.map(s => <option key={s}>{s}</option>)}</select></label><button className="button primary full" type="submit"><Check size={17} /> 保存する</button><button type="button" className="delete-link" onClick={() => { setDeleting(editing); setEditing(null); }}><Trash2 size={16} /> この教材を削除</button></form></Modal>}
    {deleting && <Modal title="教材を削除しますか？" close={() => setDeleting(null)}><p className="modal-lead">「{deleting.name}」をこのブラウザから削除します。しおりと読んだページの記録も削除されます。</p><div className="dialog-actions"><button className="button secondary" onClick={() => setDeleting(null)}>キャンセル</button><button className="button primary" onClick={() => { void deleteSheet(deleting.id).then(() => { setSheets(all => all.filter(s => s.id !== deleting.id)); setDeleting(null); notify('教材を削除しました'); }).catch(() => notify('削除できませんでした。', true)); }}><Trash2 size={16} /> 削除する</button></div></Modal>}
    {busy && <div className="busy-pill" role="status"><LoaderCircle size={18} className="spin" />{busy}</div>}
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={19} /> : <CheckCircle2 size={19} />}<span>{notice.text}</span><button aria-label="通知を閉じる" onClick={() => setNotice(null)}><X size={16} /></button></div>}
  </>;
}

function ArrowUpRightIcon() { return <ArrowRight size={16} style={{ transform: 'rotate(-35deg)' }} />; }

function Viewer({ sheet, save, close, notify }: { sheet: SheetRecord; save: (record: SheetRecord) => Promise<void>; close: () => void; notify: (text: string, error?: boolean) => void }) {
  const [record, setRecord] = useState(sheet);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null);
  const [page, setPage] = useState(sheet.page);
  const [pageInput, setPageInput] = useState(String(sheet.page));
  const [on, setOn] = useState(true);
  const [peeking, setPeeking] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [settings, setSettings] = useState(false);
  const [showPages, setShowPages] = useState(true);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [sensitivity, setSensitivity] = useState(sheet.sensitivity);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(record);
  currentRef.current = record;

  useEffect(() => {
    let alive = true; let document: PdfDocument | null = null;
    void (async () => { document = await openPdf(new Uint8Array(await sheet.blob.arrayBuffer())); if (alive) setPdf(document); else await document.loadingTask.destroy(); })().catch(() => { if (alive) { setFailure('このPDFを開けませんでした。元のPDFをもう一度取り込んでください。'); setLoading(false); } });
    return () => { alive = false; if (document) void document.loadingTask.destroy(); };
  }, [sheet.blob]);
  useEffect(() => {
    if (!pdf) return;
    let alive = true; setLoading(true); setOriginal(null); setFailure('');
    void renderPage(pdf, page, 1600).then(canvas => { if (alive) { setOriginal(canvas); stageRef.current?.scrollTo(0, 0); } }).catch(error => { if (alive && error?.name !== 'RenderingCancelledException') setFailure('ページを表示できませんでした。ページを移動するか、教材を開き直してください。'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pdf, page]);
  useEffect(() => {
    if (!original || !canvasRef.current) return;
    const displayed = on && !peeking ? applyRedSheet(original, sensitivity) : original;
    const canvas = canvasRef.current; canvas.width = displayed.width; canvas.height = displayed.height;
    canvas.getContext('2d')?.drawImage(displayed, 0, 0);
  }, [original, on, peeking, sensitivity]);
  useEffect(() => {
    const updated = { ...currentRef.current, page, sensitivity, lastOpened: Date.now() };
    currentRef.current = updated; setRecord(updated);
    const timer = setTimeout(() => { void save(currentRef.current).catch(() => notify('学習記録を保存できませんでした。空き容量を確認してください。', true)); }, 250);
    return () => clearTimeout(timer);
  }, [page, sensitivity, save, notify]);

  const changePage = useCallback((next: number) => { if (next < 1 || next > sheet.totalPages || !Number.isInteger(next)) return; setPage(next); setPageInput(String(next)); setOn(true); setPeeking(false); }, [sheet.totalPages]);
  const toggleBookmark = useCallback(() => {
    const current = currentRef.current;
    const updated = { ...current, bookmarks: current.bookmarks.includes(page) ? current.bookmarks.filter(p => p !== page) : [...current.bookmarks, page].sort((a, b) => a - b) };
    currentRef.current = updated; setRecord(updated);
    void save(updated).catch(() => notify('しおりを保存できませんでした。', true));
  }, [page, save, notify]);
  const leave = useCallback(() => { void save(currentRef.current).catch(() => notify('学習記録を保存できませんでした。', true)); close(); }, [save, close, notify]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.closest('input,select,textarea,button') || e.target.isContentEditable)) return;
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) setOn(v => !v); }
      if (e.key === 'ArrowRight') { e.preventDefault(); changePage(page + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); changePage(page - 1); }
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); toggleBookmark(); }
      if (e.key === 'Escape') leave();
    };
    const stopPeek = () => setPeeking(false);
    window.addEventListener('keydown', handler); window.addEventListener('blur', stopPeek); document.addEventListener('visibilitychange', stopPeek);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('blur', stopPeek); document.removeEventListener('visibilitychange', stopPeek); };
  }, [page, changePage, toggleBookmark, leave]);
  function download() {
    const url = URL.createObjectURL(sheet.blob); const link = document.createElement('a'); link.href = url; link.download = `${record.name}.pdf`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const pageList = bookmarkedOnly ? record.bookmarks : Array.from({ length: sheet.totalPages }, (_, n) => n + 1);
  const isMarked = record.bookmarks.includes(page);

  return <div className="viewer"><header className="viewer-header"><button className="viewer-back icon-button" onClick={leave} aria-label="ライブラリに戻る"><ArrowLeft size={21} /></button><div className="viewer-title"><span>{record.subject} <i>/</i> PDF暗記シート</span><h1>{record.name}</h1></div><button className="button secondary download-button" aria-label="PDFを保存" onClick={download}><ArrowDownToLine size={17} /><span>PDFを保存</span></button><span className="viewer-header-divider" /><button className={`sheet-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => { setOn(!on); setPeeking(false); }}><span className="switch-track"><i /></span><span>赤シート <strong>{on ? 'ON' : 'OFF'}</strong></span></button></header><div className="viewer-toolbar"><div className="toolbar-group"><button className="icon-button page-panel-toggle" onClick={() => setShowPages(!showPages)} aria-label="ページ一覧を切り替え"><PanelLeftClose size={18} /></button><span className="toolbar-label">ページ</span><button className="icon-button" disabled={page === 1} onClick={() => changePage(page - 1)} aria-label="前のページ"><ChevronLeft size={20} /></button><form className="page-jump" onSubmit={e => { e.preventDefault(); const next = Number(pageInput); if (next >= 1 && next <= sheet.totalPages && Number.isInteger(next)) changePage(next); else setPageInput(String(page)); }}><input inputMode="numeric" aria-label="ページ番号" value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={() => setPageInput(String(page))} /><span>/ {sheet.totalPages}</span></form><button className="icon-button" disabled={page === sheet.totalPages} onClick={() => changePage(page + 1)} aria-label="次のページ"><ChevronRight size={20} /></button></div><div className="toolbar-group zoom-controls"><button className="icon-button" disabled={zoom <= 50} onClick={() => setZoom(Math.max(50, zoom - 25))} aria-label="縮小"><ZoomOut size={18} /></button><button className="zoom-reset" onClick={() => setZoom(100)} aria-label="表示サイズをリセット">{zoom}%</button><button className="icon-button" disabled={zoom >= 250} onClick={() => setZoom(Math.min(250, zoom + 25))} aria-label="拡大"><ZoomIn size={18} /></button><span className="tool-divider" /><button className="icon-button fullscreen-button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => notify('このブラウザは全画面表示に対応していません。')); }} aria-label="全画面表示"><Maximize2 size={17} /></button></div><div className="toolbar-group"><button className={`icon-button ${isMarked ? 'marked' : ''}`} aria-label={isMarked ? 'しおりを外す' : 'しおりを付ける'} aria-pressed={isMarked} onClick={toggleBookmark}><Bookmark size={19} fill={isMarked ? 'currentColor' : 'none'} /></button><button className={`adjust-button ${settings ? 'selected' : ''}`} onClick={() => setSettings(!settings)} aria-expanded={settings}><Settings2 size={17} /><span>調整</span></button></div></div>
    {settings && <div className="viewer-settings"><label htmlFor="sensitivity">赤字を隠す感度 <strong>{sensitivity}</strong></label><input id="sensitivity" type="range" min="0" max="100" value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} /><p>赤字が残るときは、右へ。図や写真の赤も隠れます。</p><button className="icon-button" aria-label="調整を閉じる" onClick={() => setSettings(false)}><X size={17} /></button></div>}
    <div className="viewer-body">{showPages && <aside className="page-sidebar"><div className="page-sidebar-heading"><strong>ページ一覧</strong><span>{sheet.totalPages}</span></div><button className={`bookmark-filter ${bookmarkedOnly ? 'active' : ''}`} onClick={() => setBookmarkedOnly(!bookmarkedOnly)}><Bookmark size={14} /> しおりのみ <span>{record.bookmarks.length}</span></button><div className="page-list">{pageList.length ? pageList.map(n => <button key={n} className={`page-list-item ${page === n ? 'current' : ''}`} onClick={() => changePage(n)}><FileText size={24} strokeWidth={1.3} /><span>{String(n).padStart(2, '0')}<small>ページ</small></span>{record.bookmarks.includes(n) && <Bookmark size={13} fill="currentColor" />}{n === page && <span className="current-dot" />}</button>) : <p className="no-bookmarks">しおりを付けると<br />ここに表示されます。</p>}</div><div className="page-sidebar-tip"><ShieldCheck size={18} /><p>学習の続きは<br />自動で保存されます。</p></div></aside>}
    <div className="pdf-stage" ref={stageRef}><div className="sheet-status"><span className={on && !peeking ? 'status-dot' : 'status-dot gray'} />{on && !peeking ? '赤字を隠しています' : '答えを表示しています'}<span>·</span>{page}ページ</div>{failure ? <div className="viewer-error"><CircleHelp size={30} /><p>{failure}</p><button className="button secondary" onClick={leave}>ライブラリへ戻る</button></div> : <div className="canvas-container" style={{ width: `${zoom}%`, maxWidth: `${850 * zoom / 100}px` }}><canvas ref={canvasRef} aria-label={`${record.name} ${page}ページ、赤シート${on && !peeking ? 'オン' : 'オフ'}`} className={loading ? 'canvas-loading' : ''} />{loading && <div className="canvas-spinner"><LoaderCircle className="spin" size={28} /><span>ページを準備しています…</span></div>}</div>}<p className="stage-footnote">赤い文字が隠れていることを確認してから学習してください。</p></div></div>
    <footer className="viewer-footer"><div className="viewer-footer-note"><Keyboard size={16} /><span><kbd>Space</kbd> で赤シート切り替え</span></div><button className={`peek-button ${peeking ? 'peeking' : ''}`} disabled={!on || loading} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setPeeking(true); }} onPointerUp={() => setPeeking(false)} onPointerCancel={() => setPeeking(false)} onLostPointerCapture={() => setPeeking(false)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPeeking(true); } }} onKeyUp={() => setPeeking(false)} onBlur={() => setPeeking(false)}><Eye size={17} /> 押して答えを見る</button><span className="autosave"><CheckCircle2 size={15} />端末に自動保存</span></footer>
  </div>;
}

export default App;
