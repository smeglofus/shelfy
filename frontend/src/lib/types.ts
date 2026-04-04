export interface Location {
  id: string
  room: string
  furniture: string
  shelf: string
  display_order: number
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  email: string
}

export interface LocationCreateRequest {
  room: string
  furniture: string
  shelf: string
  display_order?: number | null
}

export interface LocationUpdateRequest {
  room?: string
  furniture?: string
  shelf?: string
  display_order?: number
}

export type ReadingStatus = 'unread' | 'reading' | 'read' | 'lent'

export interface Loan {
  id: string
  book_id: string
  borrower_name: string
  borrower_contact: string | null
  lent_date: string
  due_date: string | null
  returned_date: string | null
  return_condition: 'perfect' | 'good' | 'fair' | 'damaged' | 'lost' | null
  notes: string | null
  created_at: string
  is_active: boolean
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
  shelf_position: number | null
  processing_status: BookProcessingStatus
  reading_status?: ReadingStatus   // optional until backend migration applied
  is_currently_lent?: boolean
  active_loan?: Loan | null
  created_at: string
  updated_at: string
}


export interface LoanCreateRequest {
  borrower_name: string
  borrower_contact?: string | null
  lent_date: string
  due_date?: string | null
  notes?: string | null
}

export interface LoanReturnRequest {
  returned_date: string
  return_condition: 'perfect' | 'good' | 'fair' | 'damaged' | 'lost'
  notes?: string | null
}

export interface BookListResponse {
  total: number
  page: number
  page_size: number
  items: Book[]
}

export interface BulkDeleteRequest { ids: string[] }
export interface BulkMoveRequest { ids: string[]; location_id: string | null; insert_position?: number | null }
export interface BulkStatusRequest { ids: string[]; reading_status: ReadingStatus }
export interface BulkReorderItem { id: string; location_id: string; shelf_position: number }
export interface BulkReorderRequest { items: BulkReorderItem[] }
export interface BulkOperationResponse { affected: number; operation: 'delete' | 'move' | 'status' | 'reorder' }

export interface BookListParams {
  search?: string
  locationId?: string
  unassignedOnly?: boolean
  readingStatus?: ReadingStatus | null
  language?: string
  publisher?: string
  yearFrom?: number
  yearTo?: number
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
  shelf_position?: number | null
  reading_status?: ReadingStatus
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
  shelf_position?: number | null
  reading_status?: ReadingStatus
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface AccessTokenResponse {
  access_token: string
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


export interface PurgeLibraryResponse {
  deleted_books: number
  deleted_locations: number
  deleted_loans: number
}

// Shelf scanning types
export interface ScannedBookItem {
  position: number
  title: string | null
  author: string | null
  isbn: string | null
  observed_text: string | null
  confidence: 'auto' | 'needs_review'
}

export interface ShelfScanResponse {
  job_id: string
  status: string
}

export interface ShelfScanResultResponse {
  job_id: string
  status: string
  location_id: string | null
  books: ScannedBookItem[]
  error_message: string | null
}

export interface ConfirmBookItem {
  position: number
  title: string
  author: string | null
  isbn: string | null
}

export interface ShelfScanConfirmRequest {
  location_id: string
  append_after_book_id?: string | null
  books: ConfirmBookItem[]
}

export interface ShelfScanConfirmResponse {
  created_count: number
  book_ids: string[]
}

// Enrichment types
export interface EnrichResponse {
  status: string
  book_count: number
  message: string
}

export interface EnrichBookResponse {
  book_id: string
  status: string
}

// Onboarding
export interface OnboardingStatus {
  should_show: boolean
  completed_at: string | null
  skipped_at: string | null
}

// Shared library
export type LibraryRole = 'owner' | 'editor' | 'viewer'

export interface Library {
  id: string
  name: string
  role: LibraryRole
}

export interface LibraryMember {
  user_id: string
  email: string
  role: LibraryRole
}

export interface AddMemberRequest {
  email: string
  role: LibraryRole
}

export interface UpdateMemberRoleRequest {
  role: LibraryRole
}
