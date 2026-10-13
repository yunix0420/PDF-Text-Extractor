package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadPDFFile_InvalidExtension(t *testing.T) {
	app := NewApp()
	tmpDir := t.TempDir()
	txtFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(txtFile, []byte("hello world"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, err := app.ReadPDFFile(txtFile)
	if err == nil {
		t.Fatal("expected error for non-PDF file, got nil")
	}
	if !strings.Contains(err.Error(), "not a PDF document") {
		t.Fatalf("expected 'not a PDF document' error, got: %v", err)
	}
}

func TestReadPDFFile_NonExistent(t *testing.T) {
	app := NewApp()
	tmpDir := t.TempDir()
	missingFile := filepath.Join(tmpDir, "does-not-exist.pdf")

	_, err := app.ReadPDFFile(missingFile)
	if err == nil {
		t.Fatal("expected error for non-existent PDF file, got nil")
	}
}

func TestReadPDFFile_Success(t *testing.T) {
	app := NewApp()
	tmpDir := t.TempDir()
	pdfFile := filepath.Join(tmpDir, "sample.pdf")
	expectedContent := []byte("%PDF-1.4 test payload")
	if err := os.WriteFile(pdfFile, expectedContent, 0644); err != nil {
		t.Fatalf("failed to write test PDF: %v", err)
	}

	data, err := app.ReadPDFFile(pdfFile)
	if err != nil {
		t.Fatalf("ReadPDFFile failed: %v", err)
	}
	if !bytes.Equal(data, expectedContent) {
		t.Fatalf("expected %q, got %q", expectedContent, data)
	}
}

func TestGenerateExcel_CSV(t *testing.T) {
	app := NewApp()
	tmpDir := t.TempDir()
	outCSV := filepath.Join(tmpDir, "output.csv")

	data := []PageData{
		{Page: 1, Text: "PDF-1001"},
		{Page: 2, Text: "PDF-1002, with comma"},
		{Page: 3, Text: "PDF-1003 with Turkish: şçğüöı"},
	}

	meta := ExtractionMetadata{
		ExtractionDate: "2026-10-05 10:00:00",
		PDFPath:        filepath.Join(tmpDir, "source.pdf"),
		CropBox:        CropBox{Left: 10, Top: 20, Right: 100, Bottom: 50},
		TotalPages:     3,
	}

	msg, err := app.GenerateExcel(data, outCSV, meta)
	if err != nil {
		t.Fatalf("GenerateExcel for CSV failed: %v", err)
	}
	if !strings.Contains(msg, "Saved 3 records") {
		t.Fatalf("expected message to mention 3 records, got: %s", msg)
	}

	content, err := os.ReadFile(outCSV)
	if err != nil {
		t.Fatalf("failed to read generated CSV: %v", err)
	}

	// Verify UTF-8 BOM
	if !bytes.HasPrefix(content, []byte("\xEF\xBB\xBF")) {
		t.Fatal("expected CSV to begin with UTF-8 BOM")
	}

	// Verify CRLF line endings
	strContent := string(content[3:]) // skip BOM
	if !strings.Contains(strContent, "\r\n") {
		t.Fatal("expected CSV to use CRLF line endings")
	}

	// Verify headers and row values
	if !strings.Contains(strContent, "Page,Extracted Text") {
		t.Fatal("expected CSV to have header 'Page,Extracted Text'")
	}
	if !strings.Contains(strContent, "PDF-1001") {
		t.Fatal("expected CSV to contain PDF-1001")
	}
	if !strings.Contains(strContent, "\"PDF-1002, with comma\"") {
		t.Fatal("expected CSV to quote comma-containing field")
	}
	if !strings.Contains(strContent, "PDF-1003 with Turkish: şçğüöı") {
		t.Fatal("expected CSV to preserve UTF-8 international characters")
	}
}

func TestGenerateExcel_XLSX(t *testing.T) {
	app := NewApp()
	tmpDir := t.TempDir()
	outXLSX := filepath.Join(tmpDir, "output.xlsx")

	data := []PageData{
		{Page: 1, Text: "SN-98765"},
		{Page: 2, Text: "SN-98766"},
	}

	meta := ExtractionMetadata{
		ExtractionDate: "2026-10-05 11:30:00",
		PDFPath:        filepath.Join(tmpDir, "document.pdf"),
		CropBox:        CropBox{Left: 50, Top: 60, Right: 200, Bottom: 120},
		TotalPages:     2,
	}

	msg, err := app.GenerateExcel(data, outXLSX, meta)
	if err != nil {
		t.Fatalf("GenerateExcel for XLSX failed: %v", err)
	}
	if !strings.Contains(msg, "Saved 2 records") {
		t.Fatalf("expected message to mention 2 records, got: %s", msg)
	}

	if _, err := os.Stat(outXLSX); err != nil {
		t.Fatalf("expected output.xlsx to exist, got: %v", err)
	}
}

func TestReplaceFile_Success(t *testing.T) {
	tmpDir := t.TempDir()
	src := filepath.Join(tmpDir, "temp.txt")
	dst := filepath.Join(tmpDir, "dest.txt")

	if err := os.WriteFile(src, []byte("new content"), 0644); err != nil {
		t.Fatalf("failed to write src: %v", err)
	}
	if err := os.WriteFile(dst, []byte("old content"), 0644); err != nil {
		t.Fatalf("failed to write dst: %v", err)
	}

	if err := replaceFile(src, dst); err != nil {
		t.Fatalf("replaceFile failed: %v", err)
	}

	content, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("failed to read dst: %v", err)
	}
	if string(content) != "new content" {
		t.Fatalf("expected 'new content', got '%s'", string(content))
	}
}

func TestGetAboutInfo(t *testing.T) {
	app := NewApp()
	items, err := app.GetAboutInfo()
	if err != nil {
		t.Fatalf("GetAboutInfo failed: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("expected at least one about item")
	}

	foundDev := false
	foundVersion := false
	foundRepo := false
	foundGitHubProfile := false

	for _, item := range items {
		keyLower := strings.ToLower(item.Key)

		if strings.EqualFold(item.Key, "Developer") {
			foundDev = true
			if item.Link != "" {
				t.Fatalf("expected Developer to be non-clickable (empty Link), got: %s", item.Link)
			}
		}
		if strings.EqualFold(item.Key, "Version") {
			foundVersion = true
		}
		if strings.EqualFold(item.Key, "Version Date") {
			if item.Link != "" {
				t.Fatalf("expected Version Date to be non-clickable (empty Link), got: %s", item.Link)
			}
		}
		if strings.EqualFold(item.Key, "Repository") {
			foundRepo = true
			if !strings.HasPrefix(item.Value, "https://") {
				t.Fatalf("expected Repository to show full URL starting with https://, got: %s", item.Value)
			}
		}
		if strings.Contains(keyLower, "github") && strings.Contains(keyLower, "profile") {
			foundGitHubProfile = true
		}
	}

	if !foundDev {
		t.Fatal("expected to find Developer item in about info")
	}
	if !foundVersion {
		t.Fatal("expected to find Version item in about info")
	}
	if !foundRepo {
		t.Fatal("expected to find Repository item in about info")
	}
	if !foundGitHubProfile {
		t.Fatal("expected to find GitHub Profile item in about info")
	}
}

func TestOpenURL(t *testing.T) {
	app := NewApp()
	// When ctx is nil, OpenURL returns nil without panicking
	if err := app.OpenURL("https://example.com"); err != nil {
		t.Fatalf("OpenURL failed: %v", err)
	}
}

func TestGetAppVersion(t *testing.T) {
	app := NewApp()
	info, err := app.GetAppVersion()
	if err != nil {
		t.Fatalf("GetAppVersion failed: %v", err)
	}
	if info.Version == "" {
		t.Fatal("expected non-empty version")
	}
	if info.VersionDate == "" {
		t.Fatal("expected non-empty version date")
	}

	// Verify it matches what GetAboutInfo reports
	aboutItems, err := app.GetAboutInfo()
	if err != nil {
		t.Fatalf("GetAboutInfo failed: %v", err)
	}
	for _, it := range aboutItems {
		if strings.EqualFold(it.Key, "Version") && it.Value != info.Version {
			t.Fatalf("version mismatch: GetAboutInfo has %q, GetAppVersion has %q", it.Value, info.Version)
		}
		if strings.EqualFold(it.Key, "Version Date") && it.Value != info.VersionDate {
			t.Fatalf("version date mismatch: GetAboutInfo has %q, GetAppVersion has %q", it.Value, info.VersionDate)
		}
	}
}

func TestPageData_BackwardCompatibility(t *testing.T) {
	d1 := PageData{Page: 1, Text: "NewText"}
	if d1.GetText() != "NewText" {
		t.Fatalf("expected 'NewText', got '%s'", d1.GetText())
	}

	d2 := PageData{Page: 2, Number: "LegacyNumber"}
	if d2.GetText() != "LegacyNumber" {
		t.Fatalf("expected 'LegacyNumber', got '%s'", d2.GetText())
	}
}
