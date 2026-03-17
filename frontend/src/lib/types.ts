export interface Location {
  id: string
  room: string
  furniture: string
  shelf: string
  created_at: string
  updated_at: string
}

export interface LocationCreateRequest {
  room: string
  furniture: string
  shelf: string
}

export interface LocationUpdateRequest {
  room?: string
  furniture?: string
  shelf?: string
}

export type BookProcessingStatus = 'manual' | 'pending' | 'done' | 'failed' | 'partial'

export interface Book {
  id: string
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  language: string | null
  description: string | null
  publication_year: number | null
  cover_image_url: string | null
  location_id: string | null
  processing_status: BookProcessingStatus
  created_at: string
  updated_at: string
}

export interface BookListResponse {
  total: number
  page: number
  page_size: number
  items: Book[]
}

export interface BookListParams {
  search?: string
  locationId?: string
  page?: number
  pageSize?: number
}

export interface BookCreateRequest {
  title: string
  author?: string | null
  isbn?: string | null
  publisher?: string | null
  language?: string | null
  description?: string | null
  publication_year?: number | null
  cover_image_url?: string | null
  location_id?: string | null
}

export interface BookUpdateRequest {
  title?: string
  author?: string | null
  isbn?: string | null
  publisher?: string | null
  language?: string | null
  description?: string | null
  publication_year?: number | null
  cover_image_url?: string | null
  location_id?: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}


export type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface UploadJobResponse {
  job_id: string
  status: JobStatus
}

export interface JobStatusResponse {
  id: string
  status: JobStatus
  book_id: string | null
  result_json: Record<string, unknown> | null
  error_message: string | null
  attempts: number
  created_at: string
  updated_at: string
}
