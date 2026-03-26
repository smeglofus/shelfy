// Books feature hooks – re-exported from the original shared hooks file.
// The hooks live here conceptually; if the file grows, migrate the logic here directly.
export {
  useBooks,
  useBook,
  useCreateBook,
  useUpdateBook,
  useDeleteBook,
  useUploadBookImage,
  useJobStatus,
  BOOKS_QUERY_KEY,
} from '../../hooks/useBooks'
