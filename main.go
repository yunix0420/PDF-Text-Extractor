package main

import (
	"embed"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

// pdfStreamMiddleware intercepts on-demand HTTP range requests for local PDF documents.
func pdfStreamMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/pdf") {
			pdfPath := r.URL.Query().Get("path")
			if pdfPath != "" && strings.EqualFold(filepath.Ext(pdfPath), ".pdf") {
				cleanPath := filepath.Clean(pdfPath)
				if fi, err := os.Stat(cleanPath); err == nil && !fi.IsDir() {
					w.Header().Set("Access-Control-Allow-Origin", "*")
					w.Header().Set("Access-Control-Allow-Headers", "Range")
					w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
					w.Header().Set("Content-Type", "application/pdf")
					http.ServeFile(w, r, cleanPath)
					return
				}
			}
			http.NotFound(w, r)
			return
		}
		if next != nil {
			next.ServeHTTP(w, r)
		} else {
			http.NotFound(w, r)
		}
	})
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "PDF Text Extractor",
		Width:     1024,
		Height:    768,
		MinWidth:  950,
		MinHeight: 600,
		DisableResize: false,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		EnableDefaultContextMenu: false,
		AssetServer: &assetserver.Options{
			Assets: assets,
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				pdfStreamMiddleware(http.NotFoundHandler()).ServeHTTP(w, r)
			}),
			Middleware: pdfStreamMiddleware,
		},
		BackgroundColour: &options.RGBA{R: 245, G: 245, B: 245, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			About: &mac.AboutInfo{
				Title: "PDF Text Extractor",
				Icon:  icon,
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
