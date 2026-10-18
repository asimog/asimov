#!/usr/bin/env python3
"""
Synthetic seed data for smoke testing
Creates minimal test data in Neo4j to verify API functionality
"""
import os
import sys
from neo4j import GraphDatabase
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def create_synthetic_data():
    """Create synthetic test data in Neo4j"""
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "miroshark")
    
    print(f"Connecting to Neo4j: {uri}")
    
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        
        with driver.session() as session:
            # Create a simple test entity
            print("Creating synthetic test data...")
            
            # Create a test person entity
            session.run("""
                MERGE (p:Person {name: 'Test User', type: 'person'})
                SET p.created = datetime()
                RETURN p
            """)
            
            # Create a test organization entity
            session.run("""
                MERGE (o:Organization {name: 'Test Org', type: 'organization'})
                SET o.created = datetime()
                RETURN o
            """)
            
            # Create a test relationship
            session.run("""
                MATCH (p:Person {name: 'Test User'})
                MATCH (o:Organization {name: 'Test Org'})
                MERGE (p)-[r:WORKS_FOR]->(o)
                SET r.since = datetime()
                RETURN r
            """)
            
            print("✓ Synthetic data created successfully")
            
            # Verify data was created
            result = session.run("MATCH (n) RETURN count(n) as count")
            count = result.single()["count"]
            print(f"✓ Total nodes in database: {count}")
            
        driver.close()
        return True
        
    except Exception as e:
        print(f"✗ Error creating synthetic data: {e}")
        return False

def cleanup_synthetic_data():
    """Clean up synthetic test data"""
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "miroshark")
    
    print("Cleaning up synthetic test data...")
    
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        
        with driver.session() as session:
            # Delete test entities
            session.run("""
                MATCH (p:Person {name: 'Test User'})
                DETACH DELETE p
            """)
            
            session.run("""
                MATCH (o:Organization {name: 'Test Org'})
                DETACH DELETE o
            """)
            
            print("✓ Synthetic data cleaned up")
            
        driver.close()
        return True
        
    except Exception as e:
        print(f"✗ Error cleaning up synthetic data: {e}")
        return False

def main():
    """Main function"""
    if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
        success = cleanup_synthetic_data()
    else:
        success = create_synthetic_data()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())
