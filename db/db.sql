CREATE TABLE Results (
	id serial PRIMARY KEY,
	usn VARCHAR(11),
	attempt int CHECK (attempt > 0),
	sem int CHECK (sem < 9 AND sem > 0),
	subject_code VARCHAR(10),
	marks_external int CHECK (marks_external >= 0),
	marks_internal int CHECK (marks_internal >= 0),
	percentage float CHECK (percentage >= 0 AND percentage <= 100),
	UNIQUE (sem, attempt),
	FOREIGN KEY (subject_code) REFERENCES Subjects(subject_code),
	FOREIGN KEY (usn) REFERENCES Students(usn)
);

CREATE TABLE Subjects (
	subject_code VARCHAR(10) PRIMARY KEY,
	subject_name VARCHAR(50)
);

CREATE TABLE Students (
	usn VARCHAR(11) PRIMARY KEY,
	name VARCHAR(50) NOT NULL
);

-- Calculate aggregate of all semesters
SELECT usn, AVG(sem_percentage)
FROM (
	SELECT usn, sem, ((SUM(marks)/900)*100) AS sem_percentage
	FROM Results
	WHERE attemp = 1
	GROUP BY usn, sem;
) GROUP BY usn;

	
insert into results (usn, attempt, sem, subject_code, marks_external, marks_internal, percentage) values ('1ay13is071', 1, 1, '10CS32', 50, 15, 56.65); 