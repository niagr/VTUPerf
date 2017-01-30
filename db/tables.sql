CREATE TABLE Subjects (
	subject_code VARCHAR(10) PRIMARY KEY,
	subject_name VARCHAR(50)
);

CREATE TABLE Students (
	usn VARCHAR(11) PRIMARY KEY,
	name VARCHAR(50) NOT NULL
);

CREATE TABLE Results (
	id serial PRIMARY KEY,
	usn VARCHAR(11),
	attempt int CHECK (attempt > 0),
	sem int CHECK (sem < 9 AND sem > 0),
	subject_code VARCHAR(10),
	marks_external int CHECK (marks_external >= 0),
	marks_internal int CHECK (marks_internal >= 0),
	percentage float CHECK (percentage >= 0 AND percentage <= 100),
	UNIQUE (usn, sem, attempt, subject_code),
	FOREIGN KEY (subject_code) REFERENCES Subjects(subject_code),
	FOREIGN KEY (usn) REFERENCES Students(usn)
);