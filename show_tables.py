import sqlite3
import os

db_path = "/Users/lordzero1/Gulin_Workspace/data/db/gulin.db"
try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    
    if not tables:
        print("0 tablas encontradas en la base de datos.")
    else:
        print("Tablas encontradas:")
        for t in tables:
            print("-", t[0])
except Exception as e:
    print("Error:", e)
