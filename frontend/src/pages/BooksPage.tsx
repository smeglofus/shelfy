import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  useBooks,
  useCreateBook,
  useDeleteBook,
  useJobStatus,
  useUpdateBook,
  useUploadBookImage,
  BOOKS_QUERY_KEY,
} from '../hooks/useBooks'
import { useLocations } from '../hooks/useLocations'
import { getBookDetailRoute } from '../lib/routes'
import type { BookCreateRequest } from '../lib/types'

const PAGE_SIZE = 10

const EMPTY_FORM: BookCreateRequest = {
  title: '',
  author: '',
  isbn: '',
  publisher: '',
  language: '',
  description: '',
  publication_year: null,
  cover_image_url: '',
  location_id: null,
}

export function BooksPage() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [page, setPage] = useState(1)
  const [createForm, setCreateForm] = useState<BookCreateRequest>(EMPTY_FORM)
  const [editingBookId, setEditingBookId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<BookCreateRequest>(EMPTY_FORM)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const queryParams = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, search: search || undefined, locationId: selectedLocationId || undefined }),
    [page, search, selectedLocationId],
  )

  const queryClient = useQueryClient()
  const booksQuery = useBooks(queryParams)
  const locationsQuery = useLocations()
  const createMutation = useCreateBook()
  const updateMutation = useUpdateBook()
  const deleteMutation = useDeleteBook()
  const uploadMutation = useUploadBookImage()
  const jobQuery = useJobStatus(activeJobId, !!activeJobId)

  useEffect(() => {
    if (!jobQuery.data) {
      return
    }
    if (jobQuery.data.status === 'done') {
      void queryClient.invalidateQueries({ queryKey: BOOKS_QUERY_KEY })
      setActiveJobId(null)
      return
    }

    if (jobQuery.data.status === 'failed') {
      setActiveJobId(null)
    }
  }, [jobQuery.data, queryClient])

  const locationLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const location of locationsQuery.data ?? []) {
      map.set(location.id, `${location.room} / ${location.furniture} / ${location.shelf}`)
    }
    return map
  }, [locationsQuery.data])

  useEffect(() => {
    if (!booksQuery.data) {
      return
    }

    const { total, page: currentPage, page_size: currentPageSize, items } = booksQuery.data
    if (total <= 0 || items.length > 0) {
      return
    }

    const lastValidPage = Math.max(1, Math.ceil(total / currentPageSize))
    if (currentPage > lastValidPage) {
      setPage(lastValidPage)
    }
  }, [booksQuery.data])

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Books</h2>

      <form
        aria-label="book-search-form"
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          setSearch(searchInput.trim())
        }}
        style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}
      >
        <input
          aria-label="Search books"
          placeholder="Search by title, author, ISBN..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <select
          aria-label="Filter by location"
          value={selectedLocationId}
          onChange={(event) => {
            setSelectedLocationId(event.target.value)
            setPage(1)
          }}
        >
          <option value="">All locations</option>
          {(locationsQuery.data ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.room} / {location.furniture} / {location.shelf}
            </option>
          ))}
        </select>
        <button type="submit">Apply search</button>
      </form>

      <form
        aria-label="upload-book-image-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!selectedImage) {
            return
          }
          uploadMutation.mutate(selectedImage, {
            onSuccess: (result) => {
              setActiveJobId(result.job_id)
              setSelectedImage(null)
              if (fileInputRef.current) {
                fileInputRef.current.value = ''
              }
            },
          })
        }}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}
      >
        <input
          ref={fileInputRef}
          aria-label="Upload book image"
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => setSelectedImage(event.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={!selectedImage || !!activeJobId || uploadMutation.isPending}>
          {uploadMutation.isPending ? 'Uploading…' : 'Upload image'}
        </button>
        {jobQuery.data && (
          <span aria-label="job-status">Job status: {jobQuery.data.status}</span>
        )}
      </form>

      <form
        aria-label="create-book-form"
        onSubmit={(event) => {
          event.preventDefault()
          createMutation.mutate(createForm, {
            onSuccess: () => setCreateForm(EMPTY_FORM),
          })
        }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}
      >
        <input aria-label="Title" required placeholder="Title" value={createForm.title ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))} />
        <input aria-label="Author" placeholder="Author" value={createForm.author ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, author: event.target.value }))} />
        <input aria-label="ISBN" placeholder="ISBN" value={createForm.isbn ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, isbn: event.target.value }))} />
        <input aria-label="Publisher" placeholder="Publisher" value={createForm.publisher ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, publisher: event.target.value }))} />
        <input aria-label="Language" placeholder="Language" value={createForm.language ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, language: event.target.value }))} />
        <input aria-label="Publication year" type="number" placeholder="Publication year" value={createForm.publication_year ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, publication_year: event.target.value ? Number(event.target.value) : null }))} />
        <input aria-label="Cover URL" placeholder="Cover URL" value={createForm.cover_image_url ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, cover_image_url: event.target.value }))} />
        <select
          aria-label="Location"
          value={createForm.location_id ?? ''}
          onChange={(event) => setCreateForm((prev) => ({ ...prev, location_id: event.target.value || null }))}
        >
          <option value="">Unassigned</option>
          {(locationsQuery.data ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.room} / {location.furniture} / {location.shelf}
            </option>
          ))}
        </select>
        <textarea aria-label="Description" placeholder="Description" value={createForm.description ?? ''} onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))} />
        <button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Creating…' : 'Create book'}</button>
      </form>

      {booksQuery.isLoading && <p>Loading books…</p>}
      {booksQuery.isError && <p>Failed to load books.</p>}
      {booksQuery.data && booksQuery.data.total === 0 && <p>No books found.</p>}

      {booksQuery.data && booksQuery.data.total > 0 && (
        <>
          <table width="100%" cellPadding={8} style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Title</th>
                <th align="left">Author</th>
                <th align="left">Location</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {booksQuery.data.items.map((book) => {
                const isEditing = editingBookId === book.id

                return (
                  <tr key={book.id} style={{ borderTop: '1px solid #ddd' }}>
                    <td>{isEditing ? <input aria-label="Edit title" value={editForm.title ?? ''} onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))} /> : <Link to={getBookDetailRoute(book.id)}>{book.title}</Link>}</td>
                    <td>{isEditing ? <input aria-label="Edit author" value={editForm.author ?? ''} onChange={(event) => setEditForm((prev) => ({ ...prev, author: event.target.value }))} /> : (book.author || '—')}</td>
                    <td>
                      {isEditing ? (
                        <select
                          aria-label="Edit location"
                          value={editForm.location_id ?? ''}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, location_id: event.target.value || null }))}
                        >
                          <option value="">Unassigned</option>
                          {(locationsQuery.data ?? []).map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.room} / {location.furniture} / {location.shelf}
                            </option>
                          ))}
                        </select>
                      ) : (
                        (book.location_id ? locationLabelById.get(book.location_id) : null) ?? 'Unassigned'
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              updateMutation.mutate(
                                { id: book.id, payload: editForm },
                                { onSuccess: () => setEditingBookId(null) },
                              )
                            }}
                          >
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingBookId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBookId(book.id)
                              setEditForm({
                                title: book.title,
                                author: book.author,
                                isbn: book.isbn,
                                publisher: book.publisher,
                                language: book.language,
                                description: book.description,
                                publication_year: book.publication_year,
                                cover_image_url: book.cover_image_url,
                                location_id: book.location_id,
                              })
                            }}
                          >
                            Edit
                          </button>
                          <button type="button" onClick={() => setDeleteTargetId(book.id)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {deleteTargetId && (
        <div role="dialog" aria-label="delete-book-dialog" style={{ border: '1px solid #ddd', padding: '1rem', marginTop: '1rem' }}>
          <p>Are you sure you want to delete this book?</p>
          <button
            type="button"
            onClick={() => {
              deleteMutation.mutate(deleteTargetId, {
                onSuccess: () => setDeleteTargetId(null),
              })
            }}
          >
            Confirm delete
          </button>
          <button type="button" onClick={() => setDeleteTargetId(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}
