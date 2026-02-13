"use client"

import { useState, useMemo, useEffect, type KeyboardEvent } from "react"
import dynamic from "next/dynamic"
import "react-quill/dist/quill.snow.css"
import { collection, addDoc, updateDoc, deleteDoc, onSnapshot, doc, query, orderBy } from "firebase/firestore"
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth"
import { db, auth, googleProvider } from "../src/lib/firebase"

// 허용된 이메일 (환경변수로 관리)
const allowedEmail = process.env.NEXT_PUBLIC_ALLOWED_EMAIL

// ReactQuill (동적 로딩 – SSR 비활성화)
const ReactQuill = dynamic(() => import("react-quill"), { ssr: false }) as any

// NOTE 타입을 이 파일 안에서 정의합니다.
type Note = {
  id: string
  title: string
  content: string // HTML 문자열(기존 메모는 일반 텍스트도 허용)
  createdAt: string
  updatedAt: string
  // 제목 스타일 옵션 (선택 사항)
  titleBold?: boolean
  titleSize?: "sm" | "md" | "lg"
  titleColor?: string
}

// 날짜 포맷 유틸
const formatKoreanDateTime = (date: Date) => {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const isPM = date.getHours() >= 12
  const ampm = isPM ? "오후" : "오전"
  const hour12 = String(date.getHours() % 12 || 12).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  const second = String(date.getSeconds()).padStart(2, "0")
  return `${year}. ${month}. ${day}. ${ampm} ${hour12}:${minute}:${second}`
}

const initialRecentSearches = ["note", "not", "no", "n", "밀", "미", "오", "ㅇ", "ㅁ"]

// 검색 바 컴포넌트
type SearchBarProps = {
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchType: string
  onSearchTypeChange: (value: string) => void
  onSearch: () => void
}

function SearchBar({
  searchQuery,
  onSearchQueryChange,
  searchType,
  onSearchTypeChange,
  onSearch,
}: SearchBarProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      onSearch()
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 md:p-4 flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="검색어를 입력하세요..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          onClick={onSearch}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          검색
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            className="h-3 w-3"
            value="title+content"
            checked={searchType === "title+content"}
            onChange={(e) => onSearchTypeChange(e.target.value)}
          />
          <span>제목 + 내용</span>
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            className="h-3 w-3"
            value="title"
            checked={searchType === "title"}
            onChange={(e) => onSearchTypeChange(e.target.value)}
          />
          <span>제목만</span>
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            className="h-3 w-3"
            value="content"
            checked={searchType === "content"}
            onChange={(e) => onSearchTypeChange(e.target.value)}
          />
          <span>내용만</span>
        </label>
      </div>
    </div>
  )
}

// 최근 검색어 컴포넌트
type RecentSearchesProps = {
  searches: string[]
  onSearchClick: (term: string) => void
  onRemoveSearch: (term: string) => void
}

function RecentSearches({ searches, onSearchClick, onRemoveSearch }: RecentSearchesProps) {
  if (!searches.length) return null

  return (
    <div className="rounded-lg border border-border bg-card p-3 md:p-4 flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">최근 검색어</div>
      <div className="flex flex-wrap gap-2">
        {searches.map((term) => (
          <div
            key={term}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background pl-2.5 pr-1 py-1 text-xs"
          >
            <button
              type="button"
              onClick={() => onSearchClick(term)}
              className="hover:text-primary"
            >
              {term}
            </button>
            <button
              type="button"
              aria-label={`${term} 삭제`}
              onClick={() => onRemoveSearch(term)}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// 메모 상세/편집 영역 컴포넌트 (인라인 편집)
type NoteDetailProps = {
  note: Note
  onUpdate: (id: string, data: Partial<Pick<Note, "title" | "content" | "titleBold" | "titleSize" | "titleColor">>) => void
  onDelete: (id: string) => void
}

function NoteDetail({ note, onUpdate, onDelete }: NoteDetailProps) {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [titleBold, setTitleBold] = useState<boolean>(note.titleBold ?? true)
  const [titleSize, setTitleSize] = useState<"sm" | "md" | "lg">(note.titleSize ?? "md")
  const [titleColor, setTitleColor] = useState<string>(note.titleColor ?? "#111827")

  // 선택된 메모가 바뀌면 편집 값도 동기화
  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
    setTitleBold(note.titleBold ?? true)
    setTitleSize(note.titleSize ?? "md")
    setTitleColor(note.titleColor ?? "#111827")
  }, [note.id, note.title, note.content, note.titleBold, note.titleSize, note.titleColor])

  const handleTitleBlur = () => {
    const trimmed = title.trim()
    if (trimmed === note.title) return
    onUpdate(note.id, { title: trimmed || "제목 없음" })
  }

  const handleContentBlur = () => {
    if (content === note.content) return
    onUpdate(note.id, { content })
  }

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  const handleToggleTitleBold = () => {
    setTitleBold((prev) => {
      const next = !prev
      onUpdate(note.id, { titleBold: next })
      return next
    })
  }

  const handleTitleSizeChange = (size: "sm" | "md" | "lg") => {
    setTitleSize(size)
    onUpdate(note.id, { titleSize: size })
  }

  const handleTitleColorChange = (color: string) => {
    setTitleColor(color)
    onUpdate(note.id, { titleColor: color })
  }

  const titleSizeClass =
    titleSize === "sm"
      ? "text-base md:text-lg"
      : titleSize === "lg"
      ? "text-2xl md:text-3xl"
      : "text-lg md:text-xl"

  const quillModules = {
    toolbar: [
      [{ header: [false, 1, 2, 3] }],
      ["bold"],
      [{ color: [] }],
      ["clean"],
    ],
  }

  const quillFormats = ["header", "bold", "color"]

  return (
    <div className="rounded-lg border border-border bg-card p-4 md:p-5 flex flex-col gap-4 min-h-[320px] md:min-h-[460px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] md:text-xs text-muted-foreground">
            <span className="font-medium">제목 서식</span>
            <button
              type="button"
              onClick={handleToggleTitleBold}
              className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                titleBold ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
              }`}
            >
              B
            </button>
            <select
              value={titleSize}
              onChange={(e) => handleTitleSizeChange(e.target.value as "sm" | "md" | "lg")}
              className="rounded border bg-background px-1.5 py-0.5 text-[11px]"
            >
              <option value="sm">작게</option>
              <option value="md">기본</option>
              <option value="lg">크게</option>
            </select>
            <label className="inline-flex items-center gap-1">
              <span>색상</span>
              <input
                type="color"
                value={titleColor}
                onChange={(e) => handleTitleColorChange(e.target.value)}
                className="h-4 w-4 cursor-pointer border border-border rounded-sm"
              />
            </label>
          </div>
          <input
            className={`w-full bg-transparent font-semibold truncate outline-none border-b border-transparent focus:border-border pb-0.5 ${titleSizeClass}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            placeholder="제목을 입력하세요"
            style={{ color: titleColor }}
          />
          <div className="mt-1 text-[11px] md:text-xs text-muted-foreground space-x-2">
            <span>생성: {note.createdAt}</span>
            <span>수정: {note.updatedAt}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onDelete(note.id)}
            className="rounded-md bg-destructive px-2.5 py-1.5 text-xs md:text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            삭제
          </button>
        </div>
      </div>

      <div className="mt-2 flex-1 rounded-md border border-border bg-background p-0 text-sm leading-relaxed overflow-hidden">
        <div className="border-b border-border bg-card/60 px-2 py-1 text-[11px] text-muted-foreground">
          <span className="mr-2 font-medium">내용 서식</span>
          <span>굵게 / 크기 / 색상을 조절해 보세요.</span>
        </div>
        <div className="h-[260px] md:h-[360px] w-full overflow-hidden break-words">
          {/* ReactQuill은 클라이언트에서만 렌더링됩니다. */}
          <ReactQuill
            theme="snow"
            value={content}
            onChange={setContent}
            onBlur={handleContentBlur as any}
            modules={quillModules}
            formats={quillFormats}
            className="h-full [&_.ql-container]:h-[calc(100%-2.25rem)] [&_.ql-editor]:text-sm"
            placeholder="내용을 입력하세요..."
          />
        </div>
      </div>
    </div>
  )
}

// 메모 리스트 컴포넌트
type NoteListProps = {
  notes: Note[]
  selectedNoteId: string | null
  onSelectNote: (note: Note) => void
  onCreateNew: () => void
  resultCount: number
}

function NoteList({
  notes,
  selectedNoteId,
  onSelectNote,
  onCreateNew,
  resultCount,
}: NoteListProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:p-4 h-full max-h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">메모 목록</div>
        <button
          type="button"
          onClick={onCreateNew}
          className="rounded-md bg-primary px-3 py-1.5 text-xs md:text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          새 메모
        </button>
      </div>

      <div className="text-[11px] md:text-xs text-muted-foreground">
        검색 결과: <span className="font-semibold text-foreground">{resultCount}</span>개
      </div>

      <div className="mt-1 flex-1 overflow-auto rounded-md border border-border bg-background">
        {notes.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground px-3 text-center">
            검색 결과가 없습니다. 다른 검색어를 입력해보세요.
          </div>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {notes.map((note) => {
              const isSelected = note.id === selectedNoteId
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNote(note)}
                    className={`flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-accent/80 border-l-4 ${
                      isSelected ? "bg-accent/80 border-blue-500" : "border-transparent"
                    }`}
                  >
                    <span className="w-full truncate text-xs font-medium">
                      {note.title || "제목 없음"}
                    </span>
                    <span className="line-clamp-2 text-[11px] text-muted-foreground">
                      {note.content
                        ? note.content.replace(/<[^>]+>/g, "").slice(0, 120) || "내용이 없습니다."
                        : "내용이 없습니다."}
                    </span>
                    <span className="mt-0.5 text-[10px] text-muted-foreground">
                      {note.updatedAt}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchType, setSearchType] = useState("title+content")
  const [activeSearch, setActiveSearch] = useState("")
  const [recentSearches, setRecentSearches] = useState<string[]>(initialRecentSearches)
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Firebase Auth 상태 구독
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setAuthLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const isAllowedUser = !!user && !!user.email && (!!allowedEmail ? user.email === allowedEmail : true)

  // Firestore 메모 실시간 구독 (허용된 사용자에게만)
  useEffect(() => {
    if (!user || !isAllowedUser) {
      setNotes([])
      setSelectedNote(null)
      return
    }

    const q = query(collection(db, "notes"), orderBy("updatedAt", "desc"))

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedNotes: Note[] = snapshot.docs.map((d) => {
        const data = d.data() as Omit<Note, "id">
        return {
          id: d.id,
          title: data.title ?? "",
          content: data.content ?? "",
          createdAt: data.createdAt ?? "",
          updatedAt: data.updatedAt ?? "",
        }
      })

      setNotes(loadedNotes)
      setSelectedNote((prev) => {
        if (prev) {
          const stillExists = loadedNotes.find((n) => n.id === prev.id)
          return stillExists ?? (loadedNotes[0] ?? null)
        }
        return loadedNotes[0] ?? null
      })
    })

    return () => unsubscribe()
  }, [user, isAllowedUser])

  const filteredNotes = useMemo(() => {
    if (!activeSearch) return notes
    const query = activeSearch.toLowerCase()
    return notes.filter((note) => {
      if (searchType === "title") {
        return note.title.toLowerCase().includes(query)
      }
      if (searchType === "content") {
        return note.content.toLowerCase().includes(query)
      }
      return (
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query)
      )
    })
  }, [notes, activeSearch, searchType])

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setActiveSearch(searchQuery.trim())
      setRecentSearches((prev) => {
        const filtered = prev.filter((s) => s !== searchQuery.trim())
        return [searchQuery.trim(), ...filtered].slice(0, 10)
      })
    } else {
      setActiveSearch("")
    }
  }

  const handleRecentSearchClick = (term: string) => {
    setSearchQuery(term)
    setActiveSearch(term)
  }

  const handleRemoveRecentSearch = (term: string) => {
    setRecentSearches((prev) => prev.filter((s) => s !== term))
  }

  const handleSelectNote = (note: Note) => {
    setSelectedNote(note)
  }

  const handleUpdateNote = async (
    id: string,
    data: Partial<Pick<Note, "title" | "content">>
  ) => {
    const now = new Date()
    const formattedDate = formatKoreanDateTime(now)

    try {
      await updateDoc(doc(db, "notes", id), {
        ...data,
        updatedAt: formattedDate,
      })
    } catch (error) {
      console.error("메모 수정 중 오류:", error)
      alert("메모 수정 중 오류가 발생했습니다.")
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("정말로 삭제하시겠습니까?")) return

    try {
      await deleteDoc(doc(db, "notes", id))
    } catch (error) {
      console.error("메모 삭제 중 오류:", error)
      alert("메모 삭제 중 오류가 발생했습니다.")
    }
  }

  const handleCreateNew = async () => {
    const now = new Date()
    const formattedDate = formatKoreanDateTime(now)

    try {
      const docRef = await addDoc(collection(db, "notes"), {
        title: "새 메모",
        content: "",
        createdAt: formattedDate,
        updatedAt: formattedDate,
      })

      // onSnapshot 에서 상태를 갱신하지만, UX를 위해 바로 선택 상태를 업데이트
      setSelectedNote({
        id: docRef.id,
        title: "새 메모",
        content: "",
        createdAt: formattedDate,
        updatedAt: formattedDate,
      })
    } catch (error) {
      console.error("메모 생성 중 오류:", error)
      alert("메모 생성 중 오류가 발생했습니다.")
    }
  }

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      console.error("로그인 중 오류:", error)
      alert("로그인 중 오류가 발생했습니다.")
    }
  }

  const handleLogout = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error("로그아웃 중 오류:", error)
      alert("로그아웃 중 오류가 발생했습니다.")
    }
  }

  // 로그인 상태 로딩 중
  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">로그인 상태를 확인하는 중입니다...</div>
      </main>
    )
  }

  // 로그인하지 않은 경우 - 로그인 페이지
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col gap-4 items-center">
          <h1 className="text-lg font-semibold">나만의 메모 앱</h1>
          <p className="text-xs text-muted-foreground text-center">
            Google 계정으로 로그인하여 메모를 작성하고 관리할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={handleLogin}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 w-full"
          >
            Google 계정으로 로그인
          </button>
        </div>
      </main>
    )
  }

  // 로그인은 했지만 허용되지 않은 이메일
  if (!isAllowedUser) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col gap-4 items-center">
          <h1 className="text-lg font-semibold">접근 권한이 없습니다</h1>
          <p className="text-xs text-muted-foreground text-center">
            현재 로그인된 계정({user.email ?? "이메일 없음"})은 이 메모 앱에 접근할 수 없습니다.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            로그아웃
          </button>
        </div>
      </main>
    )
  }

  // 허용된 이메일로 로그인한 사용자에게만 메모 앱 표시
  return (
    <main className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">나만의 메모 앱</h1>
            <p className="text-xs text-muted-foreground">
              {user.email} 로 로그인됨
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs md:text-sm hover:bg-accent hover:text-accent-foreground"
          >
            로그아웃
          </button>
        </header>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Left Panel - Edit Form Area */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            {/* Search Bar */}
            <SearchBar
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchType={searchType}
              onSearchTypeChange={setSearchType}
              onSearch={handleSearch}
            />

            {/* Recent Searches */}
            <RecentSearches
              searches={recentSearches}
              onSearchClick={handleRecentSearchClick}
            onRemoveSearch={handleRemoveRecentSearch}
            />

            {/* Note Detail / Edit Area (인라인 편집) */}
            {selectedNote ? (
              <NoteDetail
                note={selectedNote}
                onUpdate={handleUpdateNote}
                onDelete={handleDelete}
              />
            ) : (
              <div className="rounded-lg border border-border bg-card flex items-center justify-center min-h-[480px]">
                <p className="text-muted-foreground text-sm">
                  {"메모를 선택하거나 새로 만들어주세요"}
                </p>
              </div>
            )}
          </div>

          {/* Right Panel - Note List */}
          <div className="w-full md:w-72 lg:w-80 shrink-0">
            <NoteList
              notes={filteredNotes}
              selectedNoteId={selectedNote?.id ?? null}
              onSelectNote={handleSelectNote}
              onCreateNew={handleCreateNew}
              resultCount={filteredNotes.length}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
