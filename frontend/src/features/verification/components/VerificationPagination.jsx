import React from "react";
import TablePagination from "@/components/tables/TablePagination";

export default function VerificationPagination({ page, pageCount, total, onPageChange }) {
  if (pageCount <= 1) return null;

  return (
    <TablePagination
      total={total}
      page={page}
      pageSize={10}
      onPageChange={onPageChange}
      showPageSize={false}
      itemLabel="requests"
      className="rounded-none border-0 border-t px-4 sm:px-5"
    />
  );
}
