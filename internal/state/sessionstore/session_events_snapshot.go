package sessionstore

import (
	"bytes"
	"errors"
	"io"
	"os"
)

// snapshotHeaderBytes is how much of a record's head identifies it. Marshal
// writes schema_version then type, so the type value sits well inside this.
const snapshotHeaderBytes = 256

// lastSnapshotOffset reports where the newest record that replaces the whole
// transcript begins, or ok=false when the log holds none. Opening that record
// is equivalent to replaying from byte 0: every earlier record has already been
// replaced wholesale, so decoding it would only rebuild state that is gone.
func lastSnapshotOffset(path string, size int64) (int64, bool) {
	f, err := os.Open(path)
	if err != nil {
		return 0, false
	}
	defer f.Close()
	return scanLastSnapshot(f, size)
}

// scanLastSnapshot walks the log backwards in blocks, returning the last record
// that is a replace. Records are newline-separated and Marshal does not indent,
// so a 0x0a byte is always a record boundary — a newline inside a string is the
// two-character escape, never the raw byte.
func scanLastSnapshot(f *os.File, size int64) (int64, bool) {
	if size <= 0 {
		return 0, false
	}
	const blockSize = int64(64 << 10)
	buf := make([]byte, blockSize)

	for end := size; end > 0; {
		start := max(int64(0), end-blockSize)
		n, err := f.ReadAt(buf[:end-start], start)
		if err != nil && !errors.Is(err, io.EOF) {
			return 0, false
		}
		chunk := buf[:n]
		for i := len(chunk) - 1; i >= 0; i-- {
			if chunk[i] != '\n' {
				continue
			}
			if at := start + int64(i) + 1; isSnapshotRecordAt(f, at, size) {
				return at, true
			}
		}
		if start == 0 {
			// The first record starts the file, with no newline before it.
			if isSnapshotRecordAt(f, 0, size) {
				return 0, true
			}
			break
		}
		end = start
	}
	return 0, false
}

// isSnapshotRecordAt reports whether a replace record starts exactly at off. The
// type is read from the record's own header — the first "type" key, which comes
// before the messages array — so a message whose text happens to contain
// `"type":"replace"` cannot masquerade as a snapshot.
func isSnapshotRecordAt(f *os.File, off, size int64) bool {
	if off < 0 || off >= size {
		return false
	}
	n := min(int64(snapshotHeaderBytes), size-off)
	head := make([]byte, n)
	if _, err := f.ReadAt(head, off); err != nil && !errors.Is(err, io.EOF) {
		return false
	}
	i := 0
	for i < len(head) && (head[i] == ' ' || head[i] == '\t' || head[i] == '\r') {
		i++
	}
	if i >= len(head) || head[i] != '{' {
		return false
	}
	body := head[i:]
	const typeKey = `"type":`
	at := bytes.Index(body, []byte(typeKey))
	if at < 0 {
		return false
	}
	value := bytes.TrimLeft(body[at+len(typeKey):], " \t")
	return bytes.HasPrefix(value, []byte(`"`+sessionEventTypeReplace+`"`))
}

// seekReplayStart positions f where replay should begin and reports that
// absolute offset. A negative from asks for the newest snapshot record; a jump
// is taken only when it lands exactly on one, because anything else — a stale
// offset, a foreign log, a torn header — must read from the top, which is
// always correct, merely slower.
func seekReplayStart(f *os.File, size, from int64) (int64, error) {
	start := from
	if start < 0 {
		start = 0
		if off, ok := scanLastSnapshot(f, size); ok {
			start = off
		}
	}
	if start > 0 && (start >= size || !isSnapshotRecordAt(f, start, size)) {
		start = 0
	}
	if start == 0 {
		return 0, nil
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return 0, err
		}
		return 0, nil
	}
	return start, nil
}
