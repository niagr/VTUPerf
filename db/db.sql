CREATE TABLE Results (
	id int PRIMARY KEY,
	usn VARCHAR(11),
	attempt int,
	sem int CHECK (sem < 9),
	subject_code VARCHAR(7),
	marks_external int,
	marks_internal int,
	percentage float CHECK (percentage < 100),
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

	
