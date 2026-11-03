package aiusechat

import (
	"context"
	"database/sql"
	"time"
)

// PurgeVectorDBOrphans removes skills chunks and orphaned chunks from the given vector
// database. It must be called explicitly, and never while an indexing pass is running.
//
// This file has NO build tag on purpose: the function is called from memory_brain.go,
// which is compiled in both the cgo and the !cgo builds (the wsh binary is built with
// CGO_ENABLED=0). The actual implementation is delegated to
// PurgeOrphanedAndSkillsChunks, which has a stub for the !cgo build.
func PurgeVectorDBOrphans(db *sql.DB) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	return PurgeOrphanedAndSkillsChunks(ctx, db)
}
