package main

import (
	_ "embed"
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/xuri/excelize/v2"
)

//go:embed about/about.csv
var defaultAboutCSV string

// AboutItem represents a key-value row with an optional link in the About dialog.
type AboutItem struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	Link  string `json:"link,omitempty"`
}

// VersionInfo represents canonical version and release date information from about/about.csv.
type VersionInfo struct {
	Version     string `json:"version"`
	VersionDate string `json:"versionDate"`
}

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GetAboutInfo loads metadata from about/about.csv on disk, falling back to embedded defaults.
func (a *App) GetAboutInfo() ([]AboutItem, error) {
	var csvData []byte

	// 1. Try relative to current working directory
	data, err := os.ReadFile(filepath.Join("about", "about.csv"))
	if err == nil {
		csvData = data
	} else {
		// 2. Try relative to the executable location
		exePath, exeErr := os.Executable()
		if exeErr == nil {
			exeData, exeErr2 := os.ReadFile(filepath.Join(filepath.Dir(exePath), "about", "about.csv"))
			if exeErr2 == nil {
				csvData = exeData
			}
		}
	}

	// 3. Fall back to embedded default
	if len(csvData) == 0 {
		csvData = []byte(defaultAboutCSV)
	}

	// Strip UTF-8 BOM if present
	if bytes.HasPrefix(csvData, []byte("\xEF\xBB\xBF")) {
		csvData = csvData[3:]
	}

	reader := csv.NewReader(bytes.NewReader(csvData))
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("failed to parse about.csv: %w", err)
	}

	var items []AboutItem
	for i, row := range records {
		if i == 0 && len(row) > 0 && strings.EqualFold(strings.TrimSpace(row[0]), "key") {
			// Skip CSV header row
			continue
		}
		if len(row) == 0 {
			continue
		}
		k := strings.TrimSpace(row[0])
		if k == "" {
			continue
		}
		v := ""
		if len(row) > 1 {
			v = strings.TrimSpace(row[1])
		}
		l := ""
		if len(row) > 2 {
			l = strings.TrimSpace(row[2])
		}
		items = append(items, AboutItem{
			Key:   k,
			Value: v,
			Link:  l,
		})
	}
	return items, nil
}

// GetAppVersion returns the application version and version date parsed from about.csv.
func (a *App) GetAppVersion() (VersionInfo, error) {
	items, err := a.GetAboutInfo()
	if err != nil {
		return VersionInfo{}, err
	}
	var info VersionInfo
	for _, it := range items {
		switch strings.ToLower(strings.TrimSpace(it.Key)) {
		case "version":
			info.Version = it.Value
		case "version date", "versiondate", "date":
			info.VersionDate = it.Value
		}
	}
	return info, nil
}

// OpenURL opens the specified URL in the default system browser.
func (a *App) OpenURL(targetURL string) error {
	if a.ctx == nil {
		return nil
	}
	runtime.BrowserOpenURL(a.ctx, targetURL)
	return nil
}

// ReadPDFFile safely reads the contents of a local PDF file into memory for the frontend viewer
func (a *App) ReadPDFFile(path string) ([]byte, error) {
	cleanPath := filepath.Clean(path)
	if !strings.EqualFold(filepath.Ext(cleanPath), ".pdf") {
		return nil, fmt.Errorf("selected file is not a PDF document")
	}
	info, err := os.Stat(cleanPath)
	if err != nil {
		return nil, fmt.Errorf("failed to locate PDF file: %w", err)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("specified path is a directory, not a PDF file")
	}
	data, err := os.ReadFile(cleanPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read PDF file: %w", err)
	}
	return data, nil
}

func (a *App) SelectPDF() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select PDF file",
		Filters: []runtime.FileFilter{
			{DisplayName: "PDF Files", Pattern: "*.pdf"},
		},
	})
}

func (a *App) SelectFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Destination Folder",
	})
}

type CropBox struct {
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Right  float64 `json:"right"`
	Bottom float64 `json:"bottom"`
}

type PageData struct {
	Page   int    `json:"page"`
	Text   string `json:"text"`
	Number string `json:"number,omitempty"`
}

// GetText returns the extracted text, falling back to legacy Number field for backward compatibility.
func (d PageData) GetText() string {
	if d.Text != "" {
		return d.Text
	}
	return d.Number
}

type ExtractionMetadata struct {
	ExtractionDate string  `json:"extractionDate"`
	PDFPath        string  `json:"pdfPath"`
	CropBox        CropBox `json:"cropBox"`
	TotalPages     int     `json:"totalPages"`
	AppVersion     string  `json:"appVersion,omitempty"`
}

// replaceFile atomically replaces the destination file with the source file.
// On Windows, if the destination file is open in another program (e.g. Excel),
// it detects the lock and returns an informative user error.
func replaceFile(src, dst string) error {
	err := os.Rename(src, dst)
	if err == nil {
		return nil
	}

	// On Windows, os.Rename fails if dst already exists.
	// Attempt to remove dst first.
	if removeErr := os.Remove(dst); removeErr != nil && !os.IsNotExist(removeErr) {
		return fmt.Errorf("cannot overwrite '%s'. The file may be currently open in Microsoft Excel or another program: %w", filepath.Base(dst), removeErr)
	}

	if retryErr := os.Rename(src, dst); retryErr != nil {
		return fmt.Errorf("failed to save final file: %w", retryErr)
	}

	return nil
}

// GenerateExcel takes the text extracted by pdf.js in the frontend and writes it to an Excel (.xlsx) or CSV (.csv) file
func (a *App) GenerateExcel(data []PageData, outputExcel string, meta ExtractionMetadata) (string, error) {
	cleanOutput := filepath.Clean(outputExcel)
	outPath, _ := filepath.Abs(cleanOutput)

	// If relative path and PDF path is provided, save in the PDF's directory
	if !filepath.IsAbs(outputExcel) && meta.PDFPath != "" {
		outPath = filepath.Join(filepath.Dir(meta.PDFPath), cleanOutput)
	}

	dir := filepath.Dir(outPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create destination directory: %w", err)
	}

	// Check if user requested CSV output
	if strings.EqualFold(filepath.Ext(outPath), ".csv") {
		tmpFile, err := os.CreateTemp(dir, ".export-*.tmp")
		if err != nil {
			return "", fmt.Errorf("failed to create temporary CSV file: %w", err)
		}
		tmpPath := tmpFile.Name()

		cleanup := func() {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
		}

		buf := bufio.NewWriter(tmpFile)

		// Write UTF-8 BOM so Excel and text editors properly render special characters
		if _, err := buf.WriteString("\xEF\xBB\xBF"); err != nil {
			cleanup()
			return "", fmt.Errorf("failed to write UTF-8 BOM: %w", err)
		}

		writer := csv.NewWriter(buf)
		writer.UseCRLF = true

		// Write headers
		if err := writer.Write([]string{"Page", "Extracted Text"}); err != nil {
			cleanup()
			return "", fmt.Errorf("failed to write CSV headers: %w", err)
		}

		// Write data rows
		for _, d := range data {
			row := []string{strconv.Itoa(d.Page), d.GetText()}
			if err := writer.Write(row); err != nil {
				cleanup()
				return "", fmt.Errorf("failed to write CSV row: %w", err)
			}
		}

		writer.Flush()
		if err := writer.Error(); err != nil {
			cleanup()
			return "", fmt.Errorf("failed to flush CSV writer: %w", err)
		}

		if err := buf.Flush(); err != nil {
			cleanup()
			return "", fmt.Errorf("failed to flush buffer: %w", err)
		}

		if err := tmpFile.Sync(); err != nil {
			cleanup()
			return "", fmt.Errorf("failed to sync file to disk: %w", err)
		}

		if err := tmpFile.Close(); err != nil {
			_ = os.Remove(tmpPath)
			return "", fmt.Errorf("failed to close temporary file: %w", err)
		}

		if err := replaceFile(tmpPath, outPath); err != nil {
			_ = os.Remove(tmpPath)
			return "", err
		}

		return fmt.Sprintf("Extraction complete! Saved %d records to:\n%s", len(data), outPath), nil
	}

	// For Excel format, guarantee .xlsx extension
	if !strings.EqualFold(filepath.Ext(outPath), ".xlsx") {
		outPath += ".xlsx"
	}

	tmpFile, err := os.CreateTemp(dir, ".export-*.xlsx")
	if err != nil {
		return "", fmt.Errorf("failed to create temporary Excel file: %w", err)
	}
	tmpPath := tmpFile.Name()
	_ = tmpFile.Close() // excelize will save to this path

	xf := excelize.NewFile()
	defer func() {
		if err := xf.Close(); err != nil {
			fmt.Println(err)
		}
	}()

	mainSheet := "Extracted Data"
	defaultSheet := "Sheet1"
	_ = xf.SetSheetName(defaultSheet, mainSheet)

	// Set main sheet headers
	_ = xf.SetCellValue(mainSheet, "A1", "Page")
	_ = xf.SetCellValue(mainSheet, "B1", "Extracted Text")

	_ = xf.SetColWidth(mainSheet, "A", "A", 12)
	_ = xf.SetColWidth(mainSheet, "B", "B", 40)

	headerStyle, _ := xf.NewStyle(&excelize.Style{
		Font: &excelize.Font{
			Bold: true,
		},
		Fill: excelize.Fill{
			Type:    "pattern",
			Color:   []string{"#E9ECEF"},
			Pattern: 1,
		},
	})
	if headerStyle != 0 {
		_ = xf.SetCellStyle(mainSheet, "A1", "B1", headerStyle)
	}

	for i, d := range data {
		row := i + 2
		axis, _ := excelize.CoordinatesToCellName(1, row)
		_ = xf.SetSheetRow(mainSheet, axis, &[]interface{}{d.Page, d.GetText()})
	}

	// Create additional Info sheet
	infoSheet := "Extraction Info"
	_, err = xf.NewSheet(infoSheet)
	if err == nil {
		_ = xf.SetColWidth(infoSheet, "A", "A", 28)
		_ = xf.SetColWidth(infoSheet, "B", "B", 65)

		_ = xf.SetCellValue(infoSheet, "A1", "Property")
		_ = xf.SetCellValue(infoSheet, "B1", "Value")
		if headerStyle != 0 {
			_ = xf.SetCellStyle(infoSheet, "A1", "B1", headerStyle)
		}

		extDate := meta.ExtractionDate
		if extDate == "" {
			extDate = time.Now().Format("2006-01-02 15:04:05")
		}

		appVer := meta.AppVersion
		if appVer == "" {
			if vInfo, err := a.GetAppVersion(); err == nil && vInfo.Version != "" {
				appVer = vInfo.Version
			}
		}

		cropStr := fmt.Sprintf("Left: %.0f, Top: %.0f, Right: %.0f, Bottom: %.0f",
			meta.CropBox.Left, meta.CropBox.Top, meta.CropBox.Right, meta.CropBox.Bottom)

		infoRows := [][]interface{}{
			{"Application Version", appVer},
			{"Extraction Date & Time", extDate},
			{"Source PDF Path", meta.PDFPath},
			{"Crop Box Coordinates", cropStr},
			{"Total Pages Processed", meta.TotalPages},
			{"Total Records Extracted", len(data)},
		}

		for idx, r := range infoRows {
			rowNum := idx + 2
			axis, _ := excelize.CoordinatesToCellName(1, rowNum)
			_ = xf.SetSheetRow(infoSheet, axis, &r)
		}
	}

	// Ensure the main sheet is the active sheet when opening the workbook
	mainSheetIdx, err := xf.GetSheetIndex(mainSheet)
	if err == nil && mainSheetIdx >= 0 {
		xf.SetActiveSheet(mainSheetIdx)
	}

	if err := xf.SaveAs(tmpPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("failed to save Excel file: %w", err)
	}

	if err := replaceFile(tmpPath, outPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}

	return fmt.Sprintf("Extraction complete! Saved %d records to:\n%s", len(data), outPath), nil
}
