"use client"

import { useState, useMemo, useEffect, type KeyboardEvent } from "react"
import { collection, addDoc, updateDoc, deleteDoc, onSnapshot, doc, query, orderBy } from "firebase/firestore"
import { db } from "../src/lib/firebase"

// NOTE 타입을 이 파일 안에서 정의합니다.
type Note = {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
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
}

function RecentSearches({ searches, onSearchClick }: RecentSearchesProps) {
  if (!searches.length) return null

  return (
    <div className="rounded-lg border border-border bg-card p-3 md:p-4 flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">최근 검색어</div>
      <div className="flex flex-wrap gap-2">
        {searches.map((term) => (
          <button
            key={term}
            type="button"
            onClick={() => onSearchClick(term)}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
          >
            {term}
          </button>
        ))}
      </div>
    </div>
  )
}

// 메모 상세/편집 영역 컴포넌트 (인라인 편집)
type NoteDetailProps = {
  note: Note
  onUpdate: (id: string, data: Partial<Pick<Note, "title" | "content">>) => void
  onDelete: (id: string) => void
}

function NoteDetail({ note, onUpdate, onDelete }: NoteDetailProps) {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)

  // 선택된 메모가 바뀌면 편집 값도 동기화
  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
  }, [note.id, note.title, note.content])

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

  return (
    <div className="rounded-lg border border-border bg-card p-4 md:p-5 flex flex-col gap-4 min-h-[480px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <input
            className="w-full bg-transparent text-lg md:text-xl font-semibold truncate outline-none border-b border-transparent focus:border-border pb-0.5"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            placeholder="제목을 입력하세요"
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
        <textarea
          className="w-full h-full resize-none bg-transparent p-3 outline-none text-sm whitespace-pre-wrap"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleContentBlur}
          placeholder="내용을 입력하세요..."
        />
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
                    className={`flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-accent/80 ${
                      isSelected ? "bg-accent/80" : ""
                    }`}
                  >
                    <span className="w-full truncate text-xs font-medium">
                      {note.title || "제목 없음"}
                    </span>
                    <span className="line-clamp-2 text-[11px] text-muted-foreground">
                      {note.content || "내용이 없습니다."}
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

  // Firestore 메모 실시간 구독
  useEffect(() => {
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
  }, [])

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

  return (
    <main className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-6xl flex flex-col md:flex-row gap-6">
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
    </main>
  )
}
