package openaichat

import "testing"

// Contrato de recortarEco: recibe el prefijo ya emitido al cliente y el delta
// que llega en el reintento. Devuelve el texto nuevo a emitir y si el eco ya
// termino.
//
// minSolapeEco = 4: las coincidencias de borde por debajo de ese umbral se
// consideran texto nuevo (evita descartar prosa por una coincidencia casual).
func TestRecortarEco(t *testing.T) {
	prefix := "Perfecto. Ahora verifico los servicios y"

	cases := []struct {
		name     string
		prefix   string
		delta    string
		hecho    bool
		wantOut  string
		wantDone bool
	}{
		// Eco puro: el delta ya esta en pantalla.
		{"delta dentro del prefijo", prefix, "los servicios", false, "", false},
		{"solape parcial del borde", prefix, "servicios y", false, "", false},
		{"delta repetido desde el inicio", prefix, "Perfecto", false, "", false},

		// Texto nuevo.
		{"sin solape", prefix, "ahora reviso nginx", false, "ahora reviso nginx", true},
		{"ya consumido", prefix, "texto nuevo", true, "texto nuevo", true},

		// Casos degenerados.
		{"prefijo vacio (sin reanudacion)", "", "hola", false, "hola", false},
		{"prefijo vacio con hecho", "", "x", true, "x", true},
		{"delta vacio", prefix, "", false, "", false},

		// Delta que cubre el prefijo completo y desborda.
		{"delta cubre y desborda el prefijo", "abcdefgh", "abcdefghXYZ", false, "XYZ", true},
		{"delta igual al prefijo completo", "abcdefgh", "abcdefgh", false, "", true},
	}

	for _, c := range cases {
		out, done := recortarEco(c.prefix, c.delta, c.hecho)
		if out != c.wantOut || done != c.wantDone {
			t.Errorf("%s: recortarEco(%q) = (%q,%v), esperado (%q,%v)", c.name, c.delta, out, done, c.wantOut, c.wantDone)
		}
	}
}

// El eco puede llegar troceado: dos deltas consecutivos que en conjunto cubren
// el solape con el prefijo. Los dos primeros se descartan; el tercero ya trae
// texto nuevo y se emite integro.
func TestRecortarEcoTroceado(t *testing.T) {
	prefix := "Perfecto. Ahora verifico los servicios y"

	out, done := recortarEco(prefix, "verifico los", false)
	if out != "" || done {
		t.Fatalf("primer trozo: esperado (\"\",false), obtenido (%q,%v)", out, done)
	}
	out, done = recortarEco(prefix, "servicios y", false)
	if out != "" || done {
		t.Fatalf("segundo trozo solapa entero: esperado (\"\",false), obtenido (%q,%v)", out, done)
	}
	out, done = recortarEco(prefix, " los logs", false)
	if out != " los logs" || !done {
		t.Fatalf("tercer trozo: esperado (\" los logs\",true), obtenido (%q,%v)", out, done)
	}
}

// Coincidencias por debajo de minSolapeEco no deben silenciar prosa nueva.
func TestRecortarEcoUmbral(t *testing.T) {
	out, done := recortarEco("hola mundo", "la", false)
	if out != "la" || !done {
		t.Fatalf("eco corto: esperado (\"la\",true), obtenido (%q,%v)", out, done)
	}
}
