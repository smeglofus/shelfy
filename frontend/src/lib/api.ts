import axios, { type AxiosError } from 'axios'

import { clearTokens, getAccessToken } from './auth'
import type {
  Book,
  BookCreateRequest,
  BookListParams,
  BookListResponse,
  BookUpdateRequest,
  Location,
  LocationCreateRequest,
  LocationUpdateRequest,
  LoginRequest,
  TokenResponse,
  UploadJobResponse,
  JobStatusResponse,
} from './types'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

if (!apiBaseUrl) {
  throw new Error('VITE_API_BASE_URL is not set. Check your .env file.')
}

const apiClient = axios.create({
  baseURL: apiBaseUrl,
})

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ detail?: string }>) => {
    if (error.response?.status === 401) {
      clearTokens()
    }

    return Promise.reject(error)
  },
)

export function formatApiError(error: unknown): string {
  if (axios.isAxiosError<{ detail?: string }>(error)) {
    return error.response?.data?.detail ?? error.message
  }

  return 'Something went wrong. Please try again.'
}

export async function login(payload: LoginRequest): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/api/v1/auth/login', payload)
  return response.data
}

export async function listLocations(): Promise<Location[]> {
  const response = await apiClient.get<Location[]>('/api/v1/locations')
  return response.data
}

export async function createLocation(payload: LocationCreateRequest): Promise<Location> {
  const response = await apiClient.post<Location>('/api/v1/locations', payload)
  return response.data
}

export async function updateLocation(id: string, payload: LocationUpdateRequest): Promise<Location> {
  const response = await apiClient.patch<Location>(`/api/v1/locations/${id}`, payload)
  return response.data
}

export async function deleteLocation(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/locations/${id}`)
}

export async function listBooks(params: BookListParams = {}): Promise<BookListResponse> {
  const response = await apiClient.get<BookListResponse>('/api/v1/books', {
    params: {
      search: params.search,
      location_id: params.locationId,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    },
  })

  return response.data
}

export async function getBook(id: string): Promise<Book> {
  const response = await apiClient.get<Book>(`/api/v1/books/${id}`)
  return response.data
}

export async function createBook(payload: BookCreateRequest): Promise<Book> {
  const response = await apiClient.post<Book>('/api/v1/books', payload)
  return response.data
}

export async function updateBook(id: string, payload: BookUpdateRequest): Promise<Book> {
  const response = await apiClient.patch<Book>(`/api/v1/books/${id}`, payload)
  return response.data
}

export async function deleteBook(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/books/${id}`)
}

export async function uploadBookImage(file: File): Promise<UploadJobResponse> {
  const formData = new FormData()
  formData.append('image', file)
  const response = await apiClient.post<UploadJobResponse>('/api/v1/books/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const response = await apiClient.get<JobStatusResponse>(`/api/v1/books/jobs/${jobId}`)
  return response.data
}
